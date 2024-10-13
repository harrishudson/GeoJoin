# Geo Join 
Simple Opt-In Location Sharing

![Screenshot](https://harrishudson.com/github/geojoin_snapshot1.png)

## Demo
Geo Join: [https://geojoin.org/](https://geojoin.org/).
 
## Requirements
Requires a HTML5 browser with Geolocation capabilities.

## Overview
A simple Open Source, platform independent, and friendly way to help share your geo-locations with your friends and family on an Opt-In basis per shared map. No user account is required. Just set up a Map Marker Label / Handle Name for yourself and a Unique Map Name that you can share with your friends and family - and you are ready to go. Don't send your sensitive geo-location information to the big players unnecessarily. Geo Join is built with a minimalist UI but has the core essential functions to help you share you location with your friends and family.

## Privacy
In addition to the standard web information for posted web data (such as; IP Address, invoked URL, Date/Time and User-Agent), Geo Join will send your; Map Marker Label / Handle, Map Name, Latitude, Longitude, Geo Accuracy, Heading and Speed to the server.  No other information is sent to the server.  Geo Join will remove from the server Map Label information along with geo-location information once that Label is inactive for 90 seconds and will also remove an entire Map data (for a given Map Name) once that map is inactive for more than 5 minutes.  Geo Join does not use cookies.  Map Names must be between 10 and 40 characters in length.  To mitigate against "Map Bombing" by strangers, you should consider; 1) make your Map Name as complex, unique, and long as possible, and 2) consider not to recycle or use/re-use a given Map Name for an extended period of time (ie, you perhaps should consider to periodically change your Map Name from time to time).  Note; to enhance your privacy, you should generally not have any personal identifiable information either as part of your Map Marker Label / Handle or Map Name.  If you are still concerned about sending this information - consider hosting your own copy of Geo Join. 

## Hosting Deployment Instructions
Simply place all these files in an appropriate directory on your webserver to host a copy of this app.  You may wish to tune your install somewhat to suit your needs.  If you plan to host a larger number of concurrent maps, you might increase the value of **$MAX_MAPS** at line **3** of p.php.  If you wish to permit a higher number of participants per shared map, you may like to increase the value of **$MAX_USERS_PER_MAP** at line **4** of p.php.

Note that the csv map files themselves need to be served uncached.  If you are using the Apache server, rename file **maps/dot_htaccess** to **maps/.htaccess**. If you are using a different web server other than Apache, you may need to setup the same sort of non-caching directives under the maps subdirectory as defined in the **maps/dot_htaccess** file under this directory.  Please refer to that file for further details.

## Author
Harris Hudson
 
## Contributing
Pull Requests are not currently being accepted.  If you would like to request a change, or find a bug, please raise an issue.  However, please keep in mind, this app is intended to be extremely simplistic by design.
 
## Donate
[https://harrishudson.com/#sponsor](https://harrishudson.com/#sponsor)
