#!/usr/local/bin/node

'use strict';
/*jslint
   browser: false, devel: false, node: true, rhino: false, passfail: false,
   bitwise: false, debug: false, eqeq: false, evil: false, forin: false,
   newcap: false, nomen: true, plusplus: true, regexp: false, unparam: false,
   sloppy: false, stupid: false, sub: false, vars: false, white: false,
   indent: 4, maxlen: 256
*/

var argv = require("optimist")
    .usage('Usage: $0')
    .demand(['a', 'i', 'u', 't'])
    .alias({})
    .describe({
        'a': 'Specify the mixcloud.com api access-token',
        'i': 'Specify the we are one radio.xml id here (http://tray.technobase.fm/radio.xml)',
        'u': 'Specify the we are one shoutcast stream url here',
        't': 'Specify the mixcloud.com upload tags here (format: tag1,tag2,tag...,tagN)',
        'forcemssdiscard': 'Forces TBR to discard records also when a tracklist has been specified but no mss was found'
    })
    .argv;

var accesstoken = argv.a;
var streamid = argv.i;
var streamurl = argv.u;
var tags = argv.t.split(',');
var forcemssdiscard = argv.forcemssdiscard;
var timebeforemsscheck = 300;
var subtimefromtracklist = 60;

var mssgroups = [];
var listeners = [];
var starttime = new Date();
var runid = Math.random().toString(32) + Math.random().toString(32);
var tracks = [];
var suicide = false;
var ripper = false;

var child_process = require('child_process');
var http = require('http');
var https = require('https');
var util = require('util');

var htmlspecialchars_decode = function (input) {
    return input.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#039;/g, '\'');
};

var cleanup = function () {
    setTimeout(function () {
        child_process.exec('rm /tmp/tbr-' + runid + '.mp3');
    }, 86400000);
};

var realupload = function (uploadform) {
    console.log('Uploading...');
    var uploader = child_process.spawn('curl', uploadform),
        stdout = '';
    uploader.stdout.on('data', function (chunk) {
        stdout += chunk;
        process.stdout.write(chunk);
    });
    uploader.stderr.on('data', function (chunk) {
        process.stdout.write(chunk);
    });
    uploader.stdout.once('close', function () {
        try {
            var status = JSON.parse(stdout);
            if (status.result && status.result.success) {
                console.log("Upload successful");
                cleanup();
            } else {
                console.log("Upload failed, retrying in 60 seconds");
                setTimeout(function () {
                    realupload(uploadform);
                }, 60000);
            }
        } catch (e) {
            console.log(e);
            setTimeout(function () {
                realupload(uploadform);
            }, 60000);
        }
    });
};

var upload = function () {
    var uploadname = argv.i + ' Record ' +
                     ('0' + starttime.getDate()).slice(-2) + '.' +
                     ('0' + (starttime.getMonth() + 1)).slice(-2) + '.' +
                     ('0' + starttime.getFullYear()).slice(-2) + ' ' +
                     ('0' + starttime.getHours()).slice(-2) + ':' +
                     ('0' + starttime.getMinutes()).slice(-2),
        uploadform = [],
        tagnum = 0,
        sectionnum = 0,
        min_start_time = 0,
        description = [];
    uploadform.push('-F', 'mp3=@/tmp/tbr-' + runid + '.mp3');
    uploadform.push('-F', 'name=' + uploadname);
    Object.keys(tags).forEach(function (tagkey) {
        uploadform.push('-F', 'tags-' + tagnum++ + '-tag=' + tags[tagkey]);
    });
    Object.keys(tracks).forEach(function (trackkey) {
        var start_time = 0;
        if (tracks[trackkey].start_time < min_start_time) {
            start_time = min_start_time;
        } else {
            start_time = tracks[trackkey].start_time;
        }
        min_start_time = start_time + 10;
        uploadform.push('-F', 'sections-' + sectionnum + '-artist=' + tracks[trackkey].artist);
        uploadform.push('-F', 'sections-' + sectionnum + '-song=' + tracks[trackkey].song);
        uploadform.push('-F', 'sections-' + sectionnum++ + '-start_time=' + start_time);
    });
    uploadform.push('-F', 'percentage_music=95');
    description.push(uploadname);
    Object.keys(mssgroups).forEach(function (mssgroupkey) {
        description.push(mssgroups[mssgroupkey].moderator + ' - ' +
                         mssgroups[mssgroupkey].show + ' - ' +
                         mssgroups[mssgroupkey].style);
    });
    if (listeners.length > 0) {
        description.push('Average Listenercount: ' + Math.round(listeners.reduce(function (a, b) {return a + b; }) / listeners.length));
    }
    uploadform.push('-F', 'description=' + description.join('\n'));
    uploadform.push('https://api.mixcloud.com/upload/?access_token=' + accesstoken);
    if (mssgroups.length > 0 || (tracks.length > 1 && !forcemssdiscard) || (tracks[0] && tracks[0].unreal)) {
        console.log('\'' + uploadform.join('\' \'') + '\'');
        realupload(uploadform);
    } else {
        console.log("Record has no moderator information, sleeping 24 hours and waiting for SIGHUP");
        var sighuptimeout = false;
        var sighuplistener = function () {
            clearTimeout(sighuptimeout);
            console.log('\'' + uploadform.join('\' \'') + '\'');
            realupload(uploadform);
        };
        process.on('SIGHUP', sighuplistener);
        setTimeout(function () {
            process.removeListener('SIGHUP', sighuplistener);
            cleanup();
        }, 24*60*60*1000);
    }
};

var getinfo = function () {
    var info = '';
    http.get('http://tray.technobase.fm/radio.xml', function (res) {
    //http.get('http://localhost/radio.xml.1', function (res) {
        res.setEncoding('binary');
        var mssgroup = false,
            lastmssgroup = false,
            track = false,
            lasttrack = false;
        res.on('data', function (chunk) {
            info += chunk;
        });
        res.once('end', function () {
            var moderator = false,
                show = false,
                style = false,
                artist = false,
                song = false,
                listener = false,
                streamidfound = false;
            info = info.split('\n');
            while (info[0]) {
                if (info.shift() === '<radio>') {
                    if (info.shift() === '<name>' + streamid + '</name>') {
                        streamidfound = true;
                        moderator = htmlspecialchars_decode(info.shift().slice(11, -12));
                        show = htmlspecialchars_decode(info.shift().slice(6, -7));
                        style = htmlspecialchars_decode(info.shift().slice(7, -8));
                        info.shift(); // starttime
                        info.shift(); // endtime
                        info.shift(); // link
                        info.shift(); // picture
                        artist = htmlspecialchars_decode(info.shift().slice(8, -9));
                        song = htmlspecialchars_decode(info.shift().slice(6, -7));
                        info.shift(); // release
                        listener = parseInt(info.shift().slice(10, -11), 10);
                        info = false; // the rest
                    }
                }
            }
            if (streamidfound) {
                if (((new Date()) - starttime) / 1000 >= timebeforemsscheck && (moderator !== '' || show !== '' || style !== '')) {
                    mssgroup = {'moderator': moderator, 'show': show, 'style': style};
                    lastmssgroup = mssgroups.slice(-1)[0];
                    if (!lastmssgroup || lastmssgroup.moderator !== mssgroup.moderator || lastmssgroup.show !== mssgroup.show || lastmssgroup.style !== mssgroup.style) {
                        mssgroups.push(mssgroup);
                        console.log('Updated mssgroups: ' + mssgroup.moderator + ' - ' + mssgroup.show + ' - ' + mssgroup.style);
                    }
                }
                if (artist !== '' && song !== '') {
                    track = {'artist': artist, 'song': song, 'start_time': Math.round(((new Date()) - starttime) / 1000) - subtimefromtracklist};
                    lasttrack = tracks.slice(-1)[0];
                    if (!lasttrack || lasttrack.artist !== track.artist || lasttrack.song !== track.song) {
                        tracks.push(track);
                        console.log('Updated tracks: ' + track.artist + ' - ' + track.song + ' - ' + track.start_time);
                    }
                }
                listeners.push(listener);
            } else {
                if (mssgroups.length === 0) {
                    mssgroup = {'moderator': 'Error', 'show': 'getting', 'style': 'information', 'unreal': true};
                    lastmssgroup = mssgroups.slice(-1)[0];
                    if (!lastmssgroup || lastmssgroup.moderator !== mssgroup.moderator || lastmssgroup.show !== mssgroup.show || lastmssgroup.style !== mssgroup.style) {
                        mssgroups.push(mssgroup);
                        console.log('Updated mssgroups: ' + mssgroup.moderator + ' - ' + mssgroup.show + ' - ' + mssgroup.style);
                    }
                }
                if (tracks.length === 0) {
                    track = {'artist': 'No', 'song': 'Tracklist', 'start_time': Math.round(((new Date()) - starttime) / 1000) - subtimefromtracklist, 'unreal': true};
                    lasttrack = tracks.slice(-1)[0];
                    if (!lasttrack || lasttrack.artist !== track.artist || lasttrack.song !== track.song) {
                        tracks.push(track);
                        console.log('Updated tracks: ' + track.artist + ' - ' + track.song + ' - ' + track.start_time);
                    }
                }
                console.log('Stream-ID not found in radio.xml');
            }
        });
        res.once('error', function (e) {
            if (mssgroups.length === 0) {
                mssgroup = {'moderator': 'Error', 'show': 'getting', 'style': 'information', 'unreal': true};
                lastmssgroup = mssgroups.slice(-1)[0];
                if (!lastmssgroup || lastmssgroup.moderator !== mssgroup.moderator || lastmssgroup.show !== mssgroup.show || lastmssgroup.style !== mssgroup.style) {
                    mssgroups.push(mssgroup);
                    console.log('Updated mssgroups: ' + mssgroup.moderator + ' - ' + mssgroup.show + ' - ' + mssgroup.style);
                }
            }
            if (tracks.length === 0) {
                track = {'artist': 'No', 'song': 'Tracklist', 'start_time': Math.round(((new Date()) - starttime) / 1000) - subtimefromtracklist, 'unreal': true};
                lasttrack = tracks.slice(-1)[0];
                if (!lasttrack || lasttrack.artist !== track.artist || lasttrack.song !== track.song) {
                    tracks.push(track);
                    console.log('Updated tracks: ' + track.artist + ' - ' + track.song + ' - ' + track.start_time);
                }
            }
            console.log(e);
        });
    }).once('error', function (e) {
        console.log(e);
    });
};

var getinfotimer = setInterval(function () {
    getinfo();
}, 30000);

var printwgetstderr = false;
var rip = function () {
    var starttime = new Date();
    ripper = child_process.spawn('wget', ['-c', '--tries', '0', '-T', '15', '--waitretry', '0', '-U', 'QuickTime/7.6.6', '-O', '/tmp/tbr-' + runid + '.mp3', streamurl]);
    ripper.stderr.on('data', function (chunk) {
        if (printwgetstderr) {
            process.stdout.write(chunk);
        }
    });
    ripper.stdout.once('close', function () {
        ripper = false;
        if (suicide) {
            clearInterval(getinfotimer);
            upload();
        } else {
            var endtime = new Date();
            console.log("Ripper died, respawning...");
            printwgetstderr = true;
            var waittimeout = 0;
            if (endtime - starttime <= 10000) {
                waittimeout = 5000;
            }
            setTimeout(rip, waittimeout);
        }
    });
};

process.once('SIGUSR2', function () {
    process.on('SIGUSR2', function () {
        // Do nothing (ignore);
    });
    suicide = true;
    if (ripper) {
        ripper.kill();
    }
});

rip();