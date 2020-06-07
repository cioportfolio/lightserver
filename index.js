require('dotenv').config()
const express = require('express')
const querystring = require('querystring')
const request = require('request')
var SpotifyWebApi = require('spotify-web-api-node')

// credentials are optional
var spotifyApi = new SpotifyWebApi({
    clientId: process.env.CLIENT_ID,
    clientSecret: process.env.CLIENT_SECRET,
    redirectUri: process.env.REDIRECT_URI
})

const app = express()
const port = process.env.PORT || 8001

var track_id = ''
var analysis = { not: "started" }
var token = ''
var playing = {not: "started"}
var progress = 0

if (process.env.NODE_ENV === 'development') {
    app.use((req, res, next) => {
        res.header('Access-Control-Allow-Origin', 'http://localhost:8080')
        res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept')
        next()
    })
}

//app.use(express.static('public'))

function details() {
    return `
        <a href='/'>Reset</a>
        <p> Now playing: 
        <p> ID: ${playing.id}
        <p> Artist(s): ${playing.artists.map(a => a.name).join()}
        <p> Track: ${playing.name}
        <p> Tempo: ${analysis.track.tempo}
        <p> Progress: ${progress}
        <p> Next bar in: ${analysis.bars.filter(b=>(b.start*1000 > progress))[0].start*1000 - progress}
        <p> Next section in: ${analysis.sections.filter(b=>(b.start*1000 > progress))[0].start*1000 - progress}
        <p> Next segment in: ${analysis.segments.filter(b=>(b.start*1000 > progress))[0].start*1000 - progress}
        <p> Next tatum in: ${analysis.tatums.filter(b=>(b.start*1000 > progress))[0].start*1000 - progress}
        <p> Next beat in: ${analysis.beats.filter(b=>(b.start*1000 > progress))[0].start*1000 - progress}
    `
    //        <pre> ${JSON.stringify(analysis, null, 2)} </pre>

}

app.get('/', (req, res, next) => {
    if (!token) {
        const query = querystring.stringify({
            response_type: 'code',
            client_id: process.env.CLIENT_ID,
            scope: 'user-read-playback-state',
            redirect_uri: process.env.REDIRECT_URI
        })

        res.redirect('https://accounts.spotify.com/authorize?' + query)
    } else {
        spotifyApi.getMyCurrentPlaybackState({
        })
            .then(function (data) {
                // Output items
                playing = data.body.item
                progress = data.body.progress_ms
                if (track_id != playing.id) {
                    track_id = playing.id
                    spotifyApi.getAudioAnalysisForTrack(playing.id)
                        .then(function (data) {
                            analysis = data.body
                            res.send(details())
                        }, function (err) {
                            console.log('Something went wrong!', err);
                        });
                } else {
                    res.send(details())
                }
            }, function (err) {
                console.log('Something went wrong!', err);
            });
    }
})

app.get('/callback', (req, res) => {
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

    request.post(authOptions, (error, response, body) => {
        if (!error && res.statusCode === 200) {
            console.log(`access_token: ${body.access_token}`)
            spotifyApi.setAccessToken(body.access_token)
            token = body.access_token
            res.redirect('/')
            /*             res.cookie('SPOTIFY_ACCESS_TOKEN', body.access_token)
                        res.cookie('SPOTIFY_REFRESH_TOKEN', body.refresh_token)
                        res.cookie('SPOTIFY_REFRESH_CODE', code) */

        } else {
            res.send('error: invalid_token')
        }
    })
})

app.listen(port, () => console.log('Listening on port ' + port))