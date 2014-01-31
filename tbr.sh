#!/bin/bash

sleep 34
killall -USR2 tbr.js
cd /home/tbr/
./tbr.js -a API-Key -i TechnoBase -u http://mp3.tb-stream.net/ -t technobase,record,techno,dance,handsup,livestream,show 2>&1 | logger -t tbtb$$ &
./tbr.js -a API-Key -i HouseTime -u http://mp3.ht-stream.net/ -t housetime,record,house,electro,livestream,show 2>&1 | logger -t tbht$$ &
./tbr.js -a API-Key -i HardBase -u http://mp3.hb-stream.net/ -t hardbase,record,hardstyle,jumpstyle,livestream,show 2>&1 | logger -t tbhb$$ &
./tbr.js -a API-Key -i TranceBase -u http://mp3.trb-stream.net/ -t trancebase,record,vocal-trance,progressive-trance,uplifting-trance,hard-trance,livestream,show 2>&1 | logger -t tbtrb$$ &
./tbr.js -a API-Key -i CoreTime -u http://mp3.ct-stream.net/ -t coretime,record,hardcore,industrial,speedcore,livestream,show 2>&1 | logger -t tbct$$ &
./tbr.js -a API-Key -i ClubTime -u http://mp3.clt-stream.net/ -t clubtime,record,deep-house,tech-house,minimal-house,techno,livestream,show 2>&1 | logger -t tbclt$$ &
