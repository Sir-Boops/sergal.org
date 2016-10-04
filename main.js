var express = require('express');
var app = express();
var validator = require('validator');
var fs = require('fs');
//Strings
var index = fs.readFileSync(__dirname + '/pages/index.html', 'UTF8');
var mirror_index = fs.readFileSync(__dirname + '/pages/index_mirror.html', 'UTF8');
var coins_index = fs.readFileSync(__dirname + '/pages/index_coins.html', 'UTF8');

//Serve Up Root Page
app.get('/', function(req, res) {
    //Check if IPv4 or IPv6
    var ip = req.headers['x-real-ip'];

    if (validator.isIP(ip, 4)) {
        //Write To The Data Stream
        res.write(index.replace(/%ip_hello%/, '<h3 class="pure-u-1-1 text">Hello %userip%, I see you are using IPv4. You should really look into IPv6.</h3>').replace(/%userip%/g, ip));
        res.send();
    } else {
        res.write(index.replace(/%ip_hello%/, '<h3 class="pure-u-1-1 text">Hello %userip%, I see you are using IPv6. Thank you.</h3>').replace(/%userip%/g, ip));
        res.send();
    };
});

//Serve Up Mirror Page
app.get('/mirror*', function(req, res) {
    res.write(mirror_index);
    res.send();
});

//Serve Up Coins Page
app.get('/coins*', function(req, res) {
    res.write(coins_index);
    res.send();
});

//Serve Up Assets
app.get('/static/*', function(req, res) {

    //Check For File
    fs.exists(__dirname + '/pages/assets/' + req.url.replace('/static/', ''), function(stat) {

        if (stat) {

            //File Is Real
            res.write(fs.readFileSync(__dirname + '/pages/assets/' + req.url.replace('/static/', '')), 'binary');
            res.send();
        } else {

            //Error 404
            res.write('File Not Found')
            res.status(404);
            res.send();
        };
    });
});

//Serve Up Keys
app.get('/keys/*', function(req, res) {

    //Check For File
    fs.exists(__dirname + '/assets/keys/' + req.url.replace('/keys/', ''), function(stat) {

        if (stat) {

            //File Is Real
            res.write(fs.readFileSync(__dirname + '/assets/keys/' + req.url.replace('/keys/', '')), 'binary');
            res.send();
        } else {

            //Error 404
            res.write('File Not Found')
            res.status(404);
            res.send();
        };
    });
});

app.listen(3000, function() {
    console.log('Frgl-Site Started');
});
