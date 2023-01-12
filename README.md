# Spotify disco light driver

Create a spotify developer account at https://developer.spotify.com/
Register an app at https://developer.spotify.com/documentation/web-api/quick-start/create
The redirect URI should be http://localhost:8001/callback
Note the client id and secret

Copy .env.template to .env
Fill out the client id and secret with the details provided by spotify

Run with "node index.js"
This starts a local node server at localhost:8001
If you have put a valid refresh token in the env file the server will run unattended
If not browse to localhost:8001 and log in to spotify. The server will then continue unattended. A refresh token will be shown in the node.js console and you can use this in your env file in future. 

**KEEP THE REFRESH TOKEN SECRET. DON'T SAVE IT IN A PUBLIC REPOSITORY**

When the server is running:

- host-ip:8001/ will show a simple page of track details and a simple beat animation
- host-ip:8001/progress will provide raw track and progress
- host-ip:8001/analysis will provide simplified lists of bars, beats and tatums for the playing track

For an example of how to use the /progress and /analysis APIs see https://github.com/cioportfolio/partyrings