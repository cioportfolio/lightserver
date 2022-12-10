require('dotenv').config()
// const SerialPort = require('serialport')
// const Readline = require('@serialport/parser-readline')
const express = require('express')
const querystring = require('querystring')
const request = require('request')
var SpotifyWebApi = require('spotify-web-api-node')
const path = require("path")
const socketio = require('socket.io')
const http = require('http')

// credentials are optional
var spotifyApi = new SpotifyWebApi({
    clientId: process.env.CLIENT_ID,
    clientSecret: process.env.CLIENT_SECRET,
    redirectUri: process.env.REDIRECT_URI
})

spotifyApi.setRefreshToken(process.env.REFRESH_TOKEN)

const app = express()
const port = process.env.PORT || 8001
const server = http.createServer(app)
const io = socketio.listen(server)

var track_id = ''
var analysis = null
var token = ''
var playing = null
var progress = 0
var arduino = null
var apiTime = Date.now()
var startTime = Date.now()
var updateTimer
var trackCounter = 0

if (process.env.NODE_ENV === 'development') {
    app.use((req, res, next) => {
        res.header('Access-Control-Allow-Origin', 'http://localhost:8080')
        res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept')
        next()
    })
}

const ash = callback =>
    (req, res, next) => {
        Promise.resolve(callback(req, res, next)).catch(next)
    }

//app.use(express.static('public'))

async function updateMusic(newConnection) {
    const currentTime = Date.now()
    if (currentTime - apiTime < 1000 || !token) {
        progress = currentTime - startTime
        io.emit('progress', progress)
    } else {
        apiTime = currentTime
        try {
            const trackData = await spotifyApi.getMyCurrentPlaybackState({})
            playing = trackData.body.item
            startTime = currentTime - trackData.body.progress_ms
            progress = trackData.body.progress_ms
            io.emit('progress', progress)
            if (playing && track_id != playing.id) {
                io.emit('details', playing)
                track_id = playing.id
                trackCounter++
                try {
                    const analData = await spotifyApi.getAudioAnalysisForTrack(playing.id)
                    analysis = analData.body
                    io.emit('analysis', analysis)
                } catch (error) {
                    console.log("Analysis")
                    console.log(error)
                }
            } else if (newConnection) {
                if (playing)
                    io.emit('details', playing)
                if (analysis)
                    io.emit('analysis', analysis)
            }
        } catch (error) {
            console.log("playing state")
            console.log(error)
        }
    }
}

async function refresh() {
    try {
        const response = await spotifyApi.refreshAccessToken()
        spotifyApi.setAccessToken(response.body.access_token)
        token = response.body.access_token
        console.log("Refresh access token")
    } catch (error) {
        console.log("Access token refresh error")
        console.log(error)
    }
}

app.get('/', ash(async (req, res) => {
    if (!token) {
        const query = querystring.stringify({
            response_type: 'code',
            client_id: process.env.CLIENT_ID,
            scope: 'user-read-playback-state',
            redirect_uri: process.env.REDIRECT_URI
        })
        res.redirect('https://accounts.spotify.com/authorize?' + query)
    } else {
        res.sendFile(path.join(__dirname, "index.html"));
    }
}))

const asRequest = (options) =>
    new Promise((resolve, reject) => {
        request.post(options, (error, response, body) => {
            if (error)
                return reject(error)
            if (response.statusCode === 200)
                return resolve({ ok: 1, body: body })
            return resolve({ ok: 0 })
        })
    })

app.get('/callback', ash(async (req, res) => {
    const code = req.query.code || null
    const authOptions = {
        url: 'https://accounts.spotify.com/api/token',
        form: {
            code: code,
            redirect_uri: process.env.REDIRECT_URI,
            grant_type: 'authorization_code'
        },
        headers: {
            'Authorization': 'Basic ' + (Buffer.from(process.env.CLIENT_ID + ':' + process.env.CLIENT_SECRET).toString('base64'))
        },
        json: true
    }

    try {
        const response = await asRequest(authOptions)
        if (response.ok) {
//            console.log(JSON.stringify(response.body, null, 2))
            if (!process.env.REFRESH_TOKEN) {
                console.log(`Add refresh token to env file for unattended light server: ${response.body.refresh_token}`)
            }
            spotifyApi.setAccessToken(response.body.access_token)
            spotifyApi.setRefreshToken(response.body.refresh_token)
            token = response.body.access_token
            res.redirect('/')
            /*             res.cookie('SPOTIFY_ACCESS_TOKEN', body.access_token)
                        res.cookie('SPOTIFY_REFRESH_TOKEN', body.refresh_token)
                        res.cookie('SPOTIFY_REFRESH_CODE', code) */

        } else {
            res.send('error: invalid_token')
        }
    } catch (error) {
        console.log("Auth callback")
        console.log(error)
    }
}))

function portError(err) {
    if (err) {
        console.log('Serial port error:', err.message)
    }
}

function toByte(num) {
    return num & 255
}

function toWord(num) {
    return [toByte(num >>> 8), toByte(num)]

}

async function sendToArduino(port) {
    try {
        await updateMusic()
        /*             <p> Next bar in: ${analysis.bars.filter(b => (b.start * 1000 > progress))[0].start * 1000 - progress}
                    <p> Next section in: ${analysis.sections.filter(b => (b.start * 1000 > progress))[0].start * 1000 - progress}
                    <p> Next segment in: ${analysis.segments.filter(b => (b.start * 1000 > progress))[0].start * 1000 - progress}
                    <p> Next tatum in: ${analysis.tatums.filter(b => (b.start * 1000 > progress))[0].start * 1000 - progress}
                    <p> Next beat in: ${analysis.beats.filter(b => (b.start * 1000 > progress))[0].start * 1000 - progress}
        */
        if (analysis) {
            const bar = analysis.beats.filter(b => (progress > b.start * 1000)).slice(-1)[0]
            if (bar) {
                var msg = [255, 255, toByte(Math.floor(analysis.track.tempo))]
                msg = msg.concat(toWord(Math.floor(progress / 10)))
                msg = msg.concat(toWord(Math.floor(bar.start * 100)))
                msg = msg.concat(toWord(Math.floor(bar.duration * 100)))
                port.write(msg)
            }
        }
    } catch (error) {
        console.log("Send to arduino")
        console.log(error)
    }
}

app.get('/ESP', ash(async (req, res) => {
    let msg = [0]

    try {
        await updateMusic()
        /*             <p> Next bar in: ${analysis.bars.filter(b => (b.start * 1000 > progress))[0].start * 1000 - progress}
                    <p> Next section in: ${analysis.sections.filter(b => (b.start * 1000 > progress))[0].start * 1000 - progress}
                    <p> Next segment in: ${analysis.segments.filter(b => (b.start * 1000 > progress))[0].start * 1000 - progress}
                    <p> Next tatum in: ${analysis.tatums.filter(b => (b.start * 1000 > progress))[0].start * 1000 - progress}
                    <p> Next beat in: ${analysis.beats.filter(b => (b.start * 1000 > progress))[0].start * 1000 - progress}
        */
        if (analysis) {
            console.log("ESP")
            const bar = analysis.beats.filter(b => (Math.floor(progress / 10) < Math.floor(b.start * 100)))[0]
            if (bar) {
                console.log("Bar")
                msg = [toByte(Math.floor(analysis.track.tempo))]
                msg = msg.concat(toWord(Math.floor(progress / 10)))
                msg = msg.concat(toWord(Math.floor(bar.start * 100)))
                msg = msg.concat(toWord(Math.floor(bar.duration * 100)))
//                console.log("Msg: " + msg)
            }
        }
    }
    catch (error) {
        console.log("ESP endpoint")
        console.log(error)
    }

    res.send(Buffer.from(msg))
}))

app.get('/progress', ash(async (req, res) => {
    let msg = [0]

    try {
        await updateMusic()
        msg = [1]
        msg = msg.concat(toByte(trackCounter))
        msg = msg.concat(toWord(Math.floor(progress / 10.0)))
        console.log("Progress: " + progress)

    }
    catch (error) {
        console.log("Progress endpoint")
        console.log(error)
    }

    res.send(Buffer.from(msg))
}))

app.get('/analysis', ash(async (req, res) => {
    let msg = [0]

    try {
        await updateMusic()
        /*             <p> Next bar in: ${analysis.bars.filter(b => (b.start * 1000 > progress))[0].start * 1000 - progress}
                    <p> Next section in: ${analysis.sections.filter(b => (b.start * 1000 > progress))[0].start * 1000 - progress}
                    <p> Next segment in: ${analysis.segments.filter(b => (b.start * 1000 > progress))[0].start * 1000 - progress}
                    <p> Next tatum in: ${analysis.tatums.filter(b => (b.start * 1000 > progress))[0].start * 1000 - progress}
                    <p> Next beat in: ${analysis.beats.filter(b => (b.start * 1000 > progress))[0].start * 1000 - progress}
        */
        if (analysis) {
            console.log("analysis")
            msg = [1]
            msg = msg.concat(toByte(Math.floor(analysis.track.tempo)))
            msg = msg.concat(toWord(analysis.bars.length))
            msg = msg.concat(toWord(analysis.beats.length))
            msg = msg.concat(toWord(analysis.tatums.length))
            for (i = 0; i < analysis.bars.length; i++) {
                msg = msg.concat(toWord(Math.floor(analysis.bars[i].start * 100)))
            }
            for (i = 0; i < analysis.beats.length; i++) {
                msg = msg.concat(toWord(Math.floor(analysis.beats[i].start * 100)))
            }
            for (i = 0; i < analysis.tatums.length; i++) {
                msg = msg.concat(toWord(Math.floor(analysis.tatums[i].start * 100)))
            }
            //console.log("Msg: " + msg)
        }
    }
    catch (error) {
        console.log("Analysis endpoint")
        console.log(error)
    }

    res.send(Buffer.from(msg))
}))

app.get('/port/:port', ash(async (req, res) => {
    try {
        const portList = await SerialPort.list()
        arduino = portList[req.params.port].path
        const port = new SerialPort(arduino, { baudRate: 115200 }, portError)
        port.on('error', portError)
        const parser = port.pipe(new Readline({ delimiter: '\r\n' }))
        parser.on('data', data => {
            port.flush()
            if (data === 'OK')
                sendToArduino(port).catch(console.log)
            else
                console.log('Arduino sent:', data)
        })
    } catch (error) {
        console.log("port endpoint")
        console.log(error)
    }
    clearInterval(updateTimer)
    res.redirect('/')
}))

function autoUpdate() {
    updateMusic()
}

function autoRefresh() {
    refresh()
}

io.on('connection', async socket => {
    /*     if (arduino) {
            io.emit('ports', {
                arduino: arduino,
                portList: []
            })
        } else {
            const portList = await SerialPort.list()
            io.emit('ports', {
                arduino: '',
                portList: portList
            })
        } */
    updateMusic('new')
    if (!arduino && !updateTimer)
        console.log('setting update timer')
    updateTimer = setInterval(autoUpdate, 100)
})

if (process.env.REFRESH_TOKEN) {
    console.log("Refresh Token defined in env")
    autoRefresh()
    refreshTimer = setInterval(autoRefresh,30*60*1000)
    updateTimer = setInterval(autoUpdate, 100)
} else {
    console.log("Refresh token not defined in env. Visit app in browser and login to Spotify")
}

server.listen(port, () => {
    console.log(`App running on port ${port}.`)
})