'use strict';

window.onload = function () {
    var browserStorage = window.localStorage;
    var appStorage = Windows.Storage;
    var client = Windows.Web.Http.HttpClient();

    // Create map
    var map = L.map('map', { zoomControl: false });
    var view = browserStorage['view'] ? JSON.parse(browserStorage['view']) : { latlng: [45, 0], zoom: 2 };
    map.setView(view.latlng, view.zoom);

    // Create base layers
    var baseLayer = browserStorage['baseLayer'] || 'Open Street Maps';
    var baseLayers = {
        'Open Street Maps': createLayer('http://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png'),
        'Thunderforest Cycle': createLayer('http://{s}.tile.thunderforest.com/cycle/{z}/{x}/{y}.png'),
        'Thunderforest Outdoors': createLayer('http://{s}.tile.thunderforest.com/outdoors/{z}/{x}/{y}.png'),
        'Thunderforest Landscape': createLayer('http://{s}.tile.thunderforest.com/landscape/{z}/{x}/{y}.png'),
        'Thunderforest Transport': createLayer('http://{s}.tile.thunderforest.com/transport/{z}/{x}/{y}.png'),
        'Mapbox Streets': createLayer('https://api.tiles.mapbox.com/v4/mapbox.streets/{z}/{x}/{y}.png?access_token=pk.eyJ1IjoibWFwYm94IiwiYSI6ImNpejY4NXVycTA2emYycXBndHRqcmZ3N3gifQ.rJcFIG214AriISLbB6B5aw'),
        'Mapbox Light': createLayer('https://api.tiles.mapbox.com/v4/mapbox.light/{z}/{x}/{y}.png?access_token=pk.eyJ1IjoibWFwYm94IiwiYSI6ImNpejY4NXVycTA2emYycXBndHRqcmZ3N3gifQ.rJcFIG214AriISLbB6B5aw')
    };
    baseLayers[baseLayer].addTo(map);
    var tiles = [];
    
    appStorage.ApplicationData.current.localFolder.getFilesAsync().then(files => files.forEach(file => tiles[file.name] = file.dateCreated.getTime()));

    // Create back-up
    Windows.UI.WebUI.WebUIApplication.addEventListener('enteredbackground', () => {
        console.log('Storing view');
        browserStorage['view'] = JSON.stringify({ latlng: map.getCenter(), zoom: map.getZoom() });
        browserStorage['baseLayer'] = baseLayer;
    });

    // Create location marker and accuracy circle
    var locationCircle = L.circle([0, 0], {
        color: 'royalblue',
        fillColor: 'royalblue',
        fillOpacity: 0.15,
        weight: 2,
        opacity: 0.5
    });
    var locationMarker = L.circleMarker([0, 0], {
        color: 'skyblue',
        fillColor: 'skyblue',
        fillOpacity: 0.7,
        weight: 2,
        opacity: 0.9,
        radius: 5
    });

    // Create center marker
    var centerMarker = L.circleMarker(map.getCenter(), {
        color: 'black',
        fillColor: 'black',
        fillOpacity: 0.7,
        weight: 2,
        opacity: 0.9,
        radius: 3
    }).addTo(map);

    // Create track and accuracy polygon
    var track = browserStorage['track'] ? JSON.parse(browserStorage['track']) : { latlngs: [], altitudes: [], accuracies: [], rights: [], lefts: [], timestamps: [] };
    var trackPolyline = L.polyline(track.latlngs, { color: 'red' }).addTo(map);
    trackPolyline.on('click', () => {
        console.log('Polyline clicked');
        var gpx = "<gpx version='1.1' creator='Mapp'><trk><trkseg>\n";
        for (var i = 0; i < track.length; i++) {
            gpx += "<trkpt lat='" + track.latlngs[i].lat + "' lon='" + track.latlngs[i].lng + "'><ele>" + track.altitudes[i] + "</ele><time>" + track.timestamps[i] + "</time></trkpt>\n";
        }
        gpx += "</trkseg></trk></gpx>";
        var savePicker = new appStorage.Pickers.FileSavePicker();
        savePicker.suggestedStartLocation = appStorage.Pickers.PickerLocationId.documentsLibrary;
        savePicker.fileTypeChoices.insert("GPX", [".gpx"]);
        savePicker.suggestedFileName = new Date().toISOString() + ".gpx";
        savePicker.pickSaveFileAsync().then(
            file => {
                if (file) {
                    appStorage.CachedFileManager.deferUpdates(file);
                    appStorage.FileIO.writeTextAsync(file, gpx);
                }
            }
        );
    });
    var trackPolygon = L.polygon([]).addTo(map);
    trackPolygon.update = function (i, beta) {
        track.rights[i] = L.latLng(track.latlngs[i].lat + track.accuracies[i] * Math.cos(beta), track.latlngs[i].lng + track.accuracies[i] * Math.sin(beta));
        track.lefts[i] = L.latLng(track.latlngs[i].lat + track.accuracies[i] * Math.cos(Math.PI + beta), track.latlngs[i].lng + track.accuracies[i] * Math.sin(Math.PI + beta));
        trackPolygon.setLatLngs(track.rights.concat(track.lefts.reverse()));
    };    

    // Create zoom control
    var zoomControl = L.control.zoom().addTo(map);
    zoomControl.setPosition('bottomright');

    // Create location control
    var watchID;
    L.Control.Location = L.Control.extend({
        onAdd: function () {
            var container = L.DomUtil.create('div', 'leaflet-bar');
            var link = L.DomUtil.create('a', '', container);
            link.href = '#';
            this.icon = L.DomUtil.create('img', '', link);
            this.icon.src = 'images/location-nofix.gif';

            L.DomEvent.on(link, 'click', this.onClick, this);

            return container;
        },

        onClick: function () {
            if (this.icon.src.includes('location-fix')) {
                if (map.getBounds().contains(locationMarker.getLatLng())) {
                    stopLocation();
                } else {
                    map.setView(locationMarker.getLatLng());
                }
            } else if (this.icon.src.includes('location-nofix')) {
                this.icon.src = 'images/location-animation.gif';
                locationMarker.addTo(map);
                locationCircle.addTo(map);
                watchID = navigator.geolocation.watchPosition(
                    function (ev) {
                        this.icon.src = 'images/location-fix.gif';
                        var location = L.latLng(ev.coords.latitude, ev.coords.longitude);
                        locationMarker.setLatLng(location);
                        locationCircle.setLatLng(location);
                        locationCircle.setRadius(ev.coords.accuracy);

                        if (backupTrackInterval) {
                            trackPolyline.addLatLng(location);
                            track.latlngs.push(location);
                            track.altitudes.push(ev.coords.altitude);
                            track.accuracies.push(ev.coords.accuracy);
                            track.timestamps.push(new Date(ev.timestamp).toISOString());

                            var n = track.latlngs.length - 1;
                            if (n > 0) {
                                trackPolygon.update(n, -Math.atan2(track.latlngs[n - 1].lat - track.latlngs[n].lat, track.latlngs[n - 1].lng - track.latlngs[n].lng));
                            }
                            if (n === 1) {
                                trackPolygon.update(n, -Math.atan2(track.latlngs[0].lat - track.latlngs[1].lat, track.latlngs[0].lng - track.latlngs[1].lng));
                            }
                            if (n > 1) {
                                n--;
                                var alfa1 = Math.atan2(track.latlngs[n].lng - track.latlngs[n - 1].lng, track.latlngs[n].lat - track.latlngs[n - 1].lat);
                                var alfa2 = Math.atan2(track.latlngs[n + 1].lng - track.latlngs[n].lng, track.latlngs[n + 1].lat - track.latlngs[n].lat);
                                var alfa = Math.PI + alfa1 - alfa2;
                                trackPolygon.update(n, alfa2 + alfa / 2);
                            }
                        }
                    }.bind(this),
                    function (ev) {
                        console.log('Location Error ' + ev.code + ': ' + ev.mmessage);
                        if (ev.code === 1) {
                            addMessage('locationError', 'Please allow location access in the privacy settings of your device.');
                            stopLocation();
                        } else {
                            this.icon.src = 'images/location-animation.gif';
                        }
                    }.bind(this)
                );
                enableBackgroundMode();
            } else {
                stopLocation();
            }
        }
    });
    var locationControl = new L.Control.Location({ position: 'bottomright' }).addTo(map);

    // Create track control
    var backupTrackInterval = null;
    L.Control.Track = L.Control.extend({
        onAdd: function () {
            var container = L.DomUtil.create('div', 'leaflet-bar');
            var link = L.DomUtil.create('a', '', container);
            link.href = '#';
            this.icon = L.DomUtil.create('img', '', link);
            this.icon.src = 'images/tracking-off.gif';

            L.DomEvent.on(link, 'click', this.onClick, this);

            return container;
        },
        onClick: function () {
            if (backupTrackInterval) {
                clearInterval(backupTrackInterval);
                backupTrackInterval = null;
                this.icon.src = 'images/tracking-off.gif';
            } else {
                if (track.latlngs.length > 0) {
                    var messageDialog = Windows.UI.Popups.MessageDialog('Start new track?');
                    messageDialog.commands.append(new Windows.UI.Popups.UICommand('Yes', function () {
                        track = { latlngs: [], altitudes: [], accuracies: [], timestamps: [] };
                        trackPolyline.setLatLngs([]);
                    }));
                    messageDialog.commands.append(new Windows.UI.Popups.UICommand('No', function () { }));
                    messageDialog.defaultCommandIndex = 0;
                    messageDialog.cancelCommandIndex = 1;
                    messageDialog.showAsync();
                }
                backupTrackInterval = setInterval(function () {
                    browserStorage['track'] = JSON.stringify(track);
                }, 60000);
                this.icon.src = 'images/tracking-on.gif';
            }
        }
    });
    new L.Control.Track({ position: 'bottomright' }).addTo(map);

    // Create layer control
    L.control.layers(baseLayers).addTo(map);

    // Create scale control
    L.control.scale().addTo(map);

    // Add map events
    map.on('baselayerchange', ev => baseLayer = ev.name);
    map.on('move', () => {
        var center = map.getCenter();
        centerMarker.setLatLng(center);
        if (locationControl.icon.src.includes('location-fix')) {
            var distance = map.distance(center, locationMarker.getLatLng());
            var messageText = 'Distance: ';
            messageText += distance > 1000 ? Math.round(distance / 10) / 100 + ' km.' : Math.round(distance) + ' m.';
            addMessage('distance', messageText);
        }
    });

    function createLayer(layerURL) {
        var layer = L.tileLayer(layerURL, {
            attribution: '-'
        });

        layer.on('tileloadstart', ev => {
            var coords = ev.coords;
            var tile = ev.tile;
            var uri = Windows.Foundation.Uri(tile.src);
            var fileName = ev.target._url.replace('http://', '').replace('https://', '').replace('{s}', '').replace('{x}', coords.x).replace('{y}', coords.y).replace('{z}', coords.z).replace(/\//g, '-');
            console.log('Start loading tile ' + tile.src + ', preloading with ' + fileName + ' from offline database.');
            //tile.style.background = 'url(ms-appdata:///local/' + fileName + ')';
            tile.src = '';
            tile.style.visibility = 'visible';
            tile.style.zIndex = coords.z;

            client.getBufferAsync(uri).then(
                buffer => {
                    appStorage.ApplicationData.current.localFolder.createFileAsync(fileName, appStorage.CreationCollisionOption.replaceExisting).then(
                        file => {
                            appStorage.FileIO.writeBufferAsync(file, buffer).then(
                                () => {
                                    console.log('Tile ' + fileName + ' stored in offline database.');
                                    tiles[fileName] = file.dateCreated.getTime();
                                    tile.src = 'ms-appdata:///local/' + fileName;
                                    //tile.style.background = 'url(ms-appdata:///local/' + fileName + ')';
                                },
                                () => {
                                    console.log('Error writing file: ' + fileName);
                                }
                            );
                        },
                        () => {
                            console.log('Error creating file: ' + fileName);
                        }
                    );
                },
                () => {
                    console.log('Error downloading tile: ' + uri.rawUri);
                    while (coords.z > 1 && tiles[fileName] === undefined) {
                        console.log('Tile ' + fileName + ' not found in offline database');
                        coords.z = coords.z - 1;
                        var modX = coords.x % 2;
                        var modY = coords.y % 2;
                        coords.x = Math.floor(coords.x / 2);
                        coords.y = Math.floor(coords.y / 2);
                        fileName = ev.target._url.replace('http://', '').replace('https://', '').replace('{s}', '').replace('{x}', coords.x).replace('{y}', coords.y).replace('{z}', coords.z).replace(/\//g, '-');
                        console.log('Fallback to lower zoom level with tile: ' + fileName);

                        var style = tile.style;
                        var width = style.width.replace('px', '');
                        var height = style.height.replace('px', '');
                        var transform = style.transform.replace('translate3d(', '').replace(')', '').replace(/px/g, '').split(',');
                        style.width = 2 * width + 'px';
                        style.height = 2 * height + 'px';
                        style.transform = 'translate3D(' + (transform[0] - modX * width) + 'px, ' + (transform[1] - modY * height) + 'px, 0px)';
                        style.zIndex = coords.z;
                    }
                    tile.src = 'ms-appdata:///local/' + fileName;
                    //style.background = 'url(ms-appdata:///local/' + fileName + ')';
                    //style.backgroundSize = 'cover';
                }
            );
        });

        return layer;
    }

    // Function to show dialog to user
    function addDialog(innerHTML) {
        var dialog = document.createElement('div');
        dialog.className = 'info dialog visible';
        dialog.innerHTML = innerHTML;
        dialog.style.left = 'calc(50% - ' + dialog.clientWidth / 2 + 'px)';
        dialog.style.top = 'calc(50% - ' + dialog.clientHeight / 2 + 'px)';
        document.body.appendChild(dialog);
        setTimeout(() => dialog.className = 'info dialog visible', 1);
    }

    // Function to show message to user
    var messagePosition = 5;
    function addMessage(id, text) {
        var message = document.getElementById(id);
        if (message) {
            message.innerHTML = text;
        } else {
            message = document.createElement('div');
            message.id = id;
            message.className = 'info message';
            message.innerHTML = text;
            message.style.bottom = messagePosition + 5 + 'px';
            document.body.appendChild(message);
            setTimeout(() => message.className = 'info message visible', 1);
            setTimeout(() => { message.className = 'info message hidden'; message.id = ''; messagePosition = messagePosition - 5 - message.clientHeight; }, 5000);
            setTimeout(() => document.body.removeChild(message), 6000);
            messagePosition = messagePosition + 5 + message.clientHeight;
        }
    }

    // Function to stop Geolocation
    function stopLocation() {
        locationMarker.remove();
        locationCircle.remove();
        locationControl.icon.src = 'images/location-nofix.gif';
        navigator.geolocation.clearWatch(watchID);
        disableBackgroundMode();
    }

    // Functions to run in background
    //var audioFile = Windows.Foundation.Uri('ms-appx:///appbeep.wma');
    //var audioSource = Windows.Media.Core.MediaSource.createFromUri(audioFile);

    //var playList = Windows.Media.Playback.MediaPlaybackList();
    //playList.items.append(Windows.Media.Playback.MediaPlaybackItem(audioSource));
    //playList.autoRepeatEnabled = true;

    //var audioPlayer = Windows.Media.Playback.MediaPlayer();
    //audioPlayer.source = playList;
    //audioPlayer.audioCategory = Windows.Media.Playback.MediaPlayerAudioCategory.soundEffects;
    //audioPlayer.volume = 0;

    //function enableBackgroundMode() {
    //    console.log('Background mode enabled');
    //    audioPlayer.play();
    //}

    //function disableBackgroundMode() {
    //    console.log('Background mode disabled');
    //    audioPlayer.pause();
    //}

    var extendedExecution = Windows.ApplicationModel.ExtendedExecution;
    var extendedExecutionSession = new extendedExecution.ExtendedExecutionSession();
    extendedExecutionSession.reason = extendedExecution.ExtendedExecutionReason.locationTracking;

    function enableBackgroundMode() {
        console.log('Background mode enabled');
        extendedExecutionSession.requestExtensionAsync();
    }

    function disableBackgroundMode() {
        console.log('Background mode disabled');
        extendedExecutionSession.close();
    }

    var counter = document.getElementById('counter');
    var second = 0;
    var minute = 0;
    var hour = 0;
    setInterval(() => {
        second++;
        if (second / 59 > 1) {
            second = 0;
            minute++;
        }
        if (minute / 59 > 1) {
            minute = 0;
            hour++;
        }
        counter.innerHTML = 'Active for ' + ('00' + hour).slice(-2) + ':' + ('00' + minute).slice(-2) + ':' + ('00' + second).slice(-2);
    }, 1000);

};