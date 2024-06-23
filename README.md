# Geo Join 
Simple Opt-In Location Sharing

![Screenshot](https://harrishudson.com/github/geojoin_snapshot1.png)

## Demo
Geo Join: [https://geojoin.org/](https://geojoin.org/).
 
## Requirements
Requires a HTML5 browser with Geolocation capabilities.

## Overview
A simple Open Source, platform independent, and friendly way to help share your geo-locations with your friends and family on an Opt-In basis per shared map. No user account is required. Just set up a Map User Name for yourself and a Unique Map Name that you can share with your friends and family - and you are ready to go. Don't send your sensitive geo-location information to the big players unnecessarily. Geo Join is built with a minimalist UI but has the core essential functions to help you share you location with your friends and family.

## Privacy
In addition to the standard web information for posted web data (such as; IP Address, invoked URL, Date/Time and User-Agent), Geo Join will send your; Map User Name, Unique Map Name, Latitude, Longitude, Geo Accuracy, Heading and Speed to the server. No other information is sent to the server. Geo Join will remove a User's Map information once that user is inactive for 90 seconds and will also remove an entire Map data (for a given Unique Map Name) once that map is inactive for more than 5 minutes. Geo Join does not use cookies. If you are concerned about sending this information - consider hosting your own copy of Geo Join.

## Hosting Deployment Instructions
Simply place all these files in an appropriate directory on your webserver to host a copy of this app.  You may wish to tune your install somewhat to suit your needs.  If you plan to host a larger number of concurrent maps, you might increase the value of **$MAX_MAPS** at line **3** of p.php.  If you wish to permit a higher number of participants per shared map, you may like to increase the value of **$MAX_USERS_PER_MAP** at line **4** of p.php.

Note that the csv map files themselves need to be served uncached.  If you are using the Apache server, rename file **maps/dot_htaccess** to **maps/.htaccess**. If you are using a different web server other than Apache, you may need to setup the same sort of non-caching directives under the maps subdirectory as defined in the **maps/dot_htaccess** file under this directory.  Please refer to that file for further details.
 
## Author
Harris Hudson
 
## Contributing
Pull Requests are not currently being accepted.  If you would like to request a change, or find a bug, please raise an issue.  However, please keep in mind, this app is intended to be extremely simplistic by design.
 
## Donate
[https://harrishudson.com/#sponsor](https://harrishudson.com/#sponsor)
