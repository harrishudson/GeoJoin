import {parse} from './csv.js'
import {stringify} from './csv.js'
import {distVincenty} from './vincenty.js'

const gVERSION_LITERAL = 'Geo Join v1.4 March 2026'
var gMAP
var gMAP_MARKER_LAYER
var gBASE_LAYER
var gGEO
var gGEOLOCATION_THROTTLE = false
var gIS_TRACKING = true
var gTRACKING_WARNING_TIMEOUT
var gTRACKING_RESUME_TIMEOUT
var gPROGRAMATIC_MOVE = false
var gLAST_LATITUDE = null
var gLAST_LONGITUDE = null
var gLAST_POST_LATITUDE = null
var gLAST_POST_LONGITUDE = null
var gLAST_POST_DATE = null
var gLAST_MAP_NAME = null
var gPERMIT_POLL = true
var gPERMIT_FEED = false
var gFEED_POLL = 5000
var gUSER_LIST = []
var gSTATUS_REQUESTS = 0

// --- Timing constants ---
// Minimum ms between position POSTs (geolocation throttle)
const gPOST_THROTTLE_MS = 10000   // 10 s  (was 5 s)
// Heartbeat interval when stationary
const gHEARTBEAT_MS     = 60000   // 60 s  (was 25 s)
// Minimum movement (metres) before re-posting
const gMIN_MOVE_METRES  = 20
// Jitter fraction applied to every scheduled delay (0-30%)
const gJITTER_FRAC      = 0.30

const gTILE_PROVIDERS = 
 [
  {title: 'OpenStreetMap', 
   url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', 
   attrib: 'Tiles &copy; OpenStreetMap' },
  {title: 'Esri.WorldStreetMap', 
   url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}', 
   attrib: 'Tiles &copy; Esri'},
  {title: 'Esri.WorldTopoMap', 
   url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}', 
   attrib: 'Tiles &copy; Esri'},
  {title: 'Esri.WorldImagery', 
   url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', 
   attrib: 'Tiles &copy; Esri'},
  {title: 'OSM', 
   url: 'http://{s}.tile.osm.org/{z}/{x}/{y}.png', 
   attrib: 'Tiles &copy; OpenStreetMap' },
  {title: 'OpenTopoMap',
   url: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',
   attrib: 'Tiles &copy; OpenStreetMap Style &copy; OpenTopoMap'},
  {title: 'Stamen Terrain',
   url: 'https://stamen-tiles-a.a.ssl.fastly.net/terrain/{z}/{x}/{y}.png',
   attrib: 'Tiles by Stamen Design'},
  {title: 'CartoDB.Positron',
   url: 'https://a.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', 
   attrib: '&copy; OpenStreetMap CARTO'}
 ]

// -------------------------------------------------------
// E2E Encryption helpers (AES-GCM via WebCrypto)
// -------------------------------------------------------

async function deriveKey(passphrase, salt) {
 const enc = new TextEncoder()
 const keyMaterial = await crypto.subtle.importKey(
  'raw', enc.encode(passphrase), { name: 'PBKDF2' }, false, ['deriveKey'])
 return crypto.subtle.deriveKey(
  { name: 'PBKDF2', salt: enc.encode(salt), iterations: 100000, hash: 'SHA-256' },
  keyMaterial,
  { name: 'AES-GCM', length: 256 },
  false,
  ['encrypt', 'decrypt'])
}

async function encryptField(key, plaintext) {
 const enc = new TextEncoder()
 const iv = crypto.getRandomValues(new Uint8Array(12))
 const ciphertext = await crypto.subtle.encrypt(
  { name: 'AES-GCM', iv }, key, enc.encode(String(plaintext)))
 // Encode iv + ciphertext as base64
 const combined = new Uint8Array(iv.byteLength + ciphertext.byteLength)
 combined.set(iv, 0)
 combined.set(new Uint8Array(ciphertext), iv.byteLength)
 return btoa(String.fromCharCode(...combined))
}

async function decryptField(key, b64) {
 try {
  const combined = Uint8Array.from(atob(b64), c => c.charCodeAt(0))
  const iv = combined.slice(0, 12)
  const ciphertext = combined.slice(12)
  const plainBuf = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext)
  return new TextDecoder().decode(plainBuf)
 } catch (e) {
  return null // decryption failed (wrong key or corrupted)
 }
}

// Derive a per-map salt from the map name so keys are map-scoped
function mapSalt(mapName) {
 return 'geojoin:' + mapName
}

// Return a delay of base_ms +/- up to (gJITTER_FRAC * base_ms)
// This breaks the metronomic regularity that triggers bot detection.
function jitter(base_ms) {
 const offset = base_ms * gJITTER_FRAC
 return Math.round(base_ms + (Math.random() * 2 - 1) * offset)
}

// -------------------------------------------------------
// Throbber / status
// -------------------------------------------------------

function queue_throbber() {
 gSTATUS_REQUESTS++
 document.getElementById('throbber').style.visibility = "visible"
 return gSTATUS_REQUESTS
}

function dequeue_throbber() {
 gSTATUS_REQUESTS--
 if (gSTATUS_REQUESTS <= 0) {
  gSTATUS_REQUESTS = 0
  document.getElementById('throbber').style.visibility = "hidden"
 }
}

function status_msg(msg) {
 let status_queue = document.getElementById('status_queue')
 let el = document.createElement('li')
 el.className = "status_right"
 el.innerText = msg
 status_queue.appendChild(el)
 window.setTimeout(function () {
  el.className = "status_right status_show"
  window.setTimeout(function () { status_destroy(el) }, 5000)
 }, 80)
}

function status_destroy(el) {
 el.className = "status_right"
 window.setTimeout(function () { el.remove() }, 550)
}

function show_about() {
 if ((gLAST_MAP_NAME) && (gLAST_MAP_NAME != document.getElementById('map_name_input').value)) {
  status_msg('Map Name has changed - Press "Go" or "Reset"')
  return false
 }
 close_all_dialogs()
 gPERMIT_POLL = false
 try { clearTimeout(gTRACKING_WARNING_TIMEOUT); } catch(e) {}
 try { clearTimeout(gTRACKING_RESUME_TIMEOUT); } catch(e) {}
 let ab = document.getElementById('about_dialog')
 ab.show()
 ab.scrollTo(0,0)
 return false 
}
window.show_about = show_about

// -------------------------------------------------------
// Startup cleanup ping - fire-and-forget, no-param POST
// -------------------------------------------------------
function ping_cleanup() {
 fetch('p.php', {
  method: 'POST',
  headers: { 'Content-Type': 'text/plain' },
  body: ''
 }).catch(() => {})
}

// -------------------------------------------------------
// Map startup
// -------------------------------------------------------
function map_startup() {
 // Trigger server-side cleanup of old maps on startup
 ping_cleanup()

 gMAP = L.map('map',{"zoomControl": false}).setView([0, 0], 1)
 gMAP.attributionControl.setPrefix('<span class="link" onclick="show_about()">About Geo Join</span>')

 gMAP.on('movestart', function() {
  if (a_dialog_is_open())
   return
  if (!gPROGRAMATIC_MOVE)
   gIS_TRACKING = false
  try { clearTimeout(gTRACKING_WARNING_TIMEOUT); } catch(e) {}
  try { clearTimeout(gTRACKING_RESUME_TIMEOUT); } catch(e) {}
 })

 gMAP.on('moveend', function() {
  if (a_dialog_is_open())
   return
  if (!gPROGRAMATIC_MOVE) {
   try { clearTimeout(gTRACKING_WARNING_TIMEOUT); } catch(e) {}
   try { clearTimeout(gTRACKING_RESUME_TIMEOUT); } catch(e) {}
   gTRACKING_WARNING_TIMEOUT = setTimeout(track_warning, 5000)
   gTRACKING_RESUME_TIMEOUT = setTimeout(track_resume, 65000)
  } else
   gPROGRAMATIC_MOVE = false
 })

 gMAP.on('click', function() {
  if (a_dialog_is_open()) {
   if ((gLAST_MAP_NAME) && (gLAST_MAP_NAME != document.getElementById('map_name_input').value)) {
    status_msg('Map Name has changed - Press "Go" or "Reset"')
    return false
   } else
    post_event_track_resume()
  }
  return false
 })

 document.getElementById("button_zoom_in").addEventListener('click', 
  function(e) { 
   e.stopPropagation()
   if ((gLAST_MAP_NAME) && 
       (gLAST_MAP_NAME != document.getElementById('map_name_input').value)) {
    status_msg('Map Name has changed - Press "Go" or "Reset"')
    return false
   }
   close_all_dialogs()
   gMAP.zoomIn()
   return false
  })

 document.getElementById("button_zoom_out").addEventListener('click', 
  function(e) { 
   e.stopPropagation()
   if ((gLAST_MAP_NAME) && 
       (gLAST_MAP_NAME != document.getElementById('map_name_input').value)) {
    status_msg('Map Name has changed - Press "Go" or "Reset"')
    return false
   }
   close_all_dialogs()
   gMAP.zoomOut()
   return false
 })

 document.getElementById("button_settings").addEventListener('click', 
  function(e) { 
   e.stopPropagation() 
   if (document.getElementById('map_settings_dialog').open)
    return false;
   close_all_dialogs()
   gPERMIT_POLL = false
   try { clearTimeout(gTRACKING_WARNING_TIMEOUT); } catch(e) {}
   try { clearTimeout(gTRACKING_RESUME_TIMEOUT); } catch(e) {}
   show_map_settings_dialog()
   return false 
  })

 document.getElementById('map_settings_dialog').addEventListener('click', 
  function(e) {
   e.stopPropagation()
   return false
  })

 document.getElementById('map_settings_about').addEventListener('click', 
  function(e) { 
   e.stopPropagation()
   show_about()
   return false
  })

 document.getElementById('map_settings_dialog_close').addEventListener('click', 
  function(e) { 
   e.stopPropagation()
   if (gLAST_MAP_NAME != document.getElementById('map_name_input').value) {
    status_msg('Map Name has changed - Press "Go" or "Reset"')
    return false
   }
   close_map_settings_dialog()
   post_event_track_resume()
   return false
  })

 document.getElementById('random_label').addEventListener('click', 
  async function(e) { 
   e.stopPropagation()
   status_msg('Generating Random Map Label')
   document.getElementById('map_label_input').value = await generate_random_label_name()
   gPERMIT_POLL = false
   save_map_label()
   check_and_show_map_url()
   return false
  })

 document.getElementById('random_map').addEventListener('click', 
  async function(e) { 
   e.stopPropagation()
   status_msg('Generating Random Map Name')
   document.getElementById('map_name_input').value = await generate_random_map_name()
   gPERMIT_POLL = false
   save_map_name()
   check_and_show_map_url()
   return false
  })

 document.getElementById('map_settings_dialog_copy').addEventListener('click', 
  function(e) { 
   var inp = document.createElement('input')
   inp.value = document.getElementById('dialog_url').getAttribute('href')
   var copyText = inp
   copyText.select()
   copyText.setSelectionRange(0, 99999)
   navigator.clipboard.writeText(copyText.value)
   status_msg('Copied Map URL to Clipboard')
   inp = null
   e.stopPropagation()
   return false
  })

 document.getElementById('map_settings_dialog_go').addEventListener('click', 
  function(e) { 
   submit_form()
   e.stopPropagation()
   return false
  })

 document.getElementById('map_settings_dialog_reset').addEventListener('click', 
  function(e) { 
   start_again()
   e.stopPropagation()
   return false
  })

 document.getElementById('button_resume').addEventListener('click', 
  function(e) { 
   e.stopPropagation()
   if ((gLAST_MAP_NAME) && 
       (gLAST_MAP_NAME != document.getElementById('map_name_input').value)) {
    status_msg('Map Name has changed - Press "Go" or "Reset"')
    return false
   }
   post_event_track_resume()
   return false
  })

 document.getElementById('map_label_input').addEventListener('input', 
  function(e) { 
   gPERMIT_POLL = false
   save_map_label()
   check_and_show_map_url()
   return false
  })

 document.getElementById('map_label_input').addEventListener('keypress', 
  function(e) { 
   if (e.which === 13 || e.keyCode === 13 || e.key === "Enter") {
    submit_form()
   }
  })

 document.getElementById('map_name_input').addEventListener('input', 
  function(e) { 
   gPERMIT_POLL = false
   save_map_name()
   check_and_show_map_url()
   return false
  })

 document.getElementById('map_name_input').addEventListener('keypress', 
  function(e) { 
   if (e.which === 13 || e.keyCode === 13 || e.key === "Enter") {
    submit_form()
   }
  })

 document.getElementById('map_passphrase_input').addEventListener('input',
  function(e) {
   save_map_passphrase()
   return false
  })

 document.getElementById('map_passphrase_input').addEventListener('keypress',
  function(e) {
   if (e.which === 13 || e.keyCode === 13 || e.key === "Enter") {
    submit_form()
   }
  })

 document.getElementById('about_dialog').addEventListener('click', 
  function(e) {
   e.stopPropagation()
   return false
  })

 document.getElementById('about_dialog_close').addEventListener('click', 
  function(e) { 
   e.stopPropagation()
   document.getElementById('about_dialog').close()
   post_event_track_resume()
   return false
  })

 document.getElementById('install').addEventListener('click', 
  function(e) { 
   e.stopPropagation()
   add_to_home_screen() 
   return false
  })

 document.getElementById('about_version_literal').appendChild(
  document.createTextNode(gVERSION_LITERAL))

 build_base_layer_select()
 populate_form()

 if (!validate_input()) {
  close_all_dialogs()
  gPERMIT_POLL = false
  try { clearTimeout(gTRACKING_WARNING_TIMEOUT); } catch(e) {}
  try { clearTimeout(gTRACKING_RESUME_TIMEOUT); } catch(e) {}
  show_map_settings_dialog()
 } else
  geo_startup()
}

function build_base_layer_select() {
 let base_layer_selector = document.getElementById('base_layer_selector')
 for (let i = 0; i < gTILE_PROVIDERS.length; i++) {
  let opt = document.createElement('option')
  opt.value = gTILE_PROVIDERS[i].title
  opt.textContent = gTILE_PROVIDERS[i].title
  base_layer_selector.appendChild(opt)
 }
 if (localStorage['base_layer'])
  base_layer_selector.value = localStorage['base_layer']
 base_layer_selector.addEventListener('change', set_map_base_layer)
 set_map_base_layer()
}

function set_map_base_layer() {
 let base_layer = document.getElementById('base_layer_selector').value
 localStorage['base_layer'] = base_layer
 let layer = gTILE_PROVIDERS.find((val) => {
  return val.title === base_layer
 })
 try { gMAP.removeLayer(gBASE_LAYER); } catch(e) {} 
 gBASE_LAYER = L.tileLayer(layer.url, {attribution: layer.attrib})
 if (gMAP)
  gBASE_LAYER.addTo(gMAP)
}

function a_dialog_is_open() {
 let dialogs = document.querySelectorAll('dialog')
 for (let d = 0; d < dialogs.length; d++) {
  if (dialogs[d].open)
   return true
  }
 return false
}

function close_all_dialogs() {
 let dialogs = document.querySelectorAll('dialog')
 for (let d = 0; d < dialogs.length; d++) {
  dialogs[d].close()
 }
 gPERMIT_POLL = true
 gLAST_MAP_NAME = null
}

function show_map_settings_dialog() {
 gLAST_MAP_NAME = document.getElementById('map_name_input').value
 document.getElementById('map_settings_dialog').show()
}

function close_map_settings_dialog() {
 gLAST_MAP_NAME = null
 document.getElementById('map_settings_dialog').close()
}

function populate_form() {
 if (localStorage['map_label'])
  document.getElementById('map_label_input').value = localStorage['map_label']
 // Restore passphrase from localStorage (persists across sessions, consistent
 // with map name storage - prevents silent fallback to unencrypted mode on reopen)
 if (localStorage['map_passphrase'])
  document.getElementById('map_passphrase_input').value = localStorage['map_passphrase']
 var s = window.location.search
 if (s)
  s = s.substr(1)
 if (s)
  s = decodeURIComponent(s)
 if (s) {
  document.getElementById('map_name_input').value = s
 } else {
  if (localStorage['map_name'])
   document.getElementById('map_name_input').value = localStorage['map_name']
 }
 check_and_show_map_url()
 set_map_base_layer()
}

function validate_map_label(quiet) {
 let map_map_label = document.getElementById('map_label_input').value
 let map_label_stripped = map_map_label.replace(/\s/g, "")
 if (!map_label_stripped) {
  if (!quiet)
   status_msg('Please enter a Label / Handle for yourself')
  return false
 }
 let map_name_trim = map_map_label.trim()
 if (map_name_trim.length > 40) {
  if (!quiet)
   status_msg('Label / Handle must be 40 characters or less in length')
  return false
 }
 return true
}

function validate_map_url(quiet) {
 let map_name = document.getElementById('map_name_input').value
 let map_name_stripped = map_name.replace(/\s/g, "")
 if (!map_name_stripped) {
  if (!quiet)
   status_msg('Please enter a Unique Map Name between 10 and 40 characters')
  return false
 }
 let map_name_len = map_name.length
 if ((map_name_len < 10) || (map_name_len > 40)) {
  if (!quiet)
   status_msg('Please enter a Unique Map Name between 10 and 40 characters')
  return false
 }
 return true
}

function validate_input(quiet) {
 if (!validate_map_label(quiet))
  return false
 if (!validate_map_url(quiet))
  return false
 return true
}

function get_passphrase() {
 return (document.getElementById('map_passphrase_input').value || '').trim()
}

function check_and_show_map_url() {
 let is_valid = validate_input(true)
 let map_url_header = document.getElementById('dialog_url_header')
 let map_url_section = document.getElementById('dialog_url_section')
 if (!is_valid) {
  map_url_header.style.display = 'none'
  map_url_section.style.display = 'none'
  document.getElementById('map_title').textContent = ''
  return
 }
 let loc = window.location
 let origin = loc.origin
 var pathname = loc.pathname
 if ((pathname.substr(-5) != '.html') && (pathname.substr(-1) != '/')) {
  pathname += '/'
 }
 let map_name = document.getElementById('map_name_input').value
 let s = encodeURIComponent(map_name)
 let href = origin + pathname + '?' + s
 let dialog_url = document.getElementById('dialog_url')
 dialog_url.setAttribute('href', href)
 dialog_url.textContent = href
 map_url_header.style.display = 'block'
 map_url_section.style.display = 'block'
 save_map_label()
 save_map_name()
 document.getElementById('map_title').textContent = map_name
}

function save_map_label() {
 if (validate_map_label(true))
  localStorage['map_label'] = document.getElementById('map_label_input').value
 else
  clear_map_label()
}

function clear_map_label() {
 localStorage['map_label'] = ''
}

function save_map_name() {
 if (validate_map_url(true))
  localStorage['map_name'] = document.getElementById('map_name_input').value
 else
  clear_map_name()
}

function clear_map_name() {
 localStorage['map_name'] = ''
}

function save_map_passphrase() {
 let passphrase = get_passphrase()
 if (passphrase)
  localStorage['map_passphrase'] = passphrase
 else
  localStorage.removeItem('map_passphrase')
}

function set_map_location() {
 if (!validate_map_url(true))
  return
 let map_name = document.getElementById('map_name_input').value
 let s = encodeURIComponent(map_name)
 let loc = window.location
 let origin = loc.origin
 var pathname = loc.pathname
 if ((pathname.substr(-5) != '.html') && (pathname.substr(-1) != '/')) 
  pathname += '/'
 window.location = origin + pathname + '?' + s
}

function reset_map_location() {
 let loc = window.location
 let origin = loc.origin
 var pathname = loc.pathname
 if ((pathname.substr(-5) != '.html') && (pathname.substr(-1) != '/')) 
  pathname += '/'
 window.location = origin + pathname 
}

function start_again() {
 clear_map_label()
 clear_map_name()
 localStorage['base_layer'] = ''
 localStorage.removeItem('map_passphrase')
 reset_map_location()
}

function submit_form() {
 if (!validate_input())
  return
 close_all_dialogs()
 set_map_location()
}

async function generate_random_label_name() {
 const adjectives = [
  "Swift", "Fierce", "Brave", "Clever", "Mighty", "Sly", "Chill", 
  "Radiant", "Mysterious", "Lone", "Fearless", "Wandering", "Lucky", 
  "Silent", "Bold"
 ]
 const nouns = [
  "Falcon", "Tiger", "Wolf", "Phoenix", "Shadow", "Eagle", "Lion", 
  "Warrior", "Dragon", "Fox", "Raven", "Knight", "Hunter", "Sage", 
  "Nomad"
 ]
 const randomAdjective = adjectives[Math.floor(Math.random() * adjectives.length)]
 const randomNoun = nouns[Math.floor(Math.random() * nouns.length)]
 return `${randomAdjective}${randomNoun}${Math.floor(Math.random() * 1000)}`
}

async function generate_random_map_name() {
 var rname = await hashSHA256(Math.random())
 return rname.substr(-32)
}

function geo_startup() {
 gPERMIT_POLL = true
 gGEO = navigator.geolocation.watchPosition(
  geoupdate, geofailure, { enableHighAccuracy: true })
 setInterval(geo_heartbeat, gHEARTBEAT_MS)
 setTimeout(fetch_map, jitter(gFEED_POLL))
}
 
function geoupdate(e) {
 gLAST_LATITUDE = e.coords.latitude
 gLAST_LONGITUDE = e.coords.longitude
 if (gGEOLOCATION_THROTTLE) return
 gGEOLOCATION_THROTTLE = true
 setTimeout(function(){ gGEOLOCATION_THROTTLE = false }, gPOST_THROTTLE_MS)
 let coords = {}
 coords.latitude = e.coords.latitude
 coords.longitude = e.coords.longitude
 coords.accuracy =  e.coords.accuracy || ''
 coords.speed = e.coords.speed || ''
 coords.heading = e.coords.heading || ''
 check_and_post_position(coords)
}

function check_and_post_position(coords) {
 if (!gPERMIT_POLL)
  return
 if (!isFinite(coords.latitude) || !isFinite(coords.longitude))
  return
 if ((gLAST_POST_LATITUDE) && (gLAST_POST_LONGITUDE)) {
  let v = distVincenty(gLAST_POST_LATITUDE, gLAST_POST_LONGITUDE, coords.latitude, coords.longitude)
  if (v != 0) {
   let d = v.distance
   if (d < gMIN_MOVE_METRES) return
  }
 }

 gLAST_POST_LATITUDE = coords.latitude
 gLAST_POST_LONGITUDE = coords.longitude
 gLAST_POST_DATE = new Date()

 post_position(coords)
}

async function post_position(coords) {
 let map_name = document.getElementById('map_name_input').value
 let map_label = document.getElementById('map_label_input').value
 let passphrase = get_passphrase()

 let payload_stringified

 if (passphrase) {
  try {
   let salt = mapSalt(map_name)
   let key = await deriveKey(passphrase, salt)
   // Label stays plaintext - needed by server for deduplication.
   // Only the geo fields (lat, lon, accuracy, speed, heading) are encrypted.
   let enc_lat     = await encryptField(key, coords.latitude)
   let enc_lon     = await encryptField(key, coords.longitude)
   let enc_acc     = await encryptField(key, coords.accuracy)
   let enc_speed   = await encryptField(key, coords.speed)
   let enc_heading = await encryptField(key, coords.heading)
   let payload = [[
    map_name,
    map_label, enc_lat, enc_lon, enc_acc, enc_speed, enc_heading,
    'enc'
   ]]
   payload_stringified = stringify(payload)
  } catch(e) {
   console.error('Encryption error:', e)
   status_msg('Encryption error - check passphrase')
   return
  }
 } else {
  let payload = [[
   map_name,
   map_label,
   coords.latitude,
   coords.longitude,
   coords.accuracy,
   coords.speed,
   coords.heading
  ]]
  payload_stringified = stringify(payload)
 }

 fetch('p.php', {
  method: 'POST',
  headers: { 'Content-Type': 'text/plain' },
  body: payload_stringified
  })
  .then(response => response.text())
  .then(data => {
   if (data != 'ok') {
    status_msg('Map Request Failure')
    gPERMIT_FEED = false
   } else
    gPERMIT_FEED = true
  })
  .catch((error) => { console.error('Map Request Error:', error) })
}

function geofailure(e) {
 status_msg('Geolocation failure.  Please note that enabling geolocation is required in order for this application to work correctly.')
 status_msg(e)
 console.log(e)
}

function geo_heartbeat() {
 let now = new Date()
 if (!gLAST_POST_DATE)
  return
 if (now - gLAST_POST_DATE < gHEARTBEAT_MS)
  return
 if ((!gLAST_POST_LATITUDE) || (!gLAST_POST_LONGITUDE))
  return
 let coords = {}
 coords.latitude = gLAST_POST_LATITUDE
 coords.longitude = gLAST_POST_LONGITUDE
 coords.accuracy = ''
 coords.speed = ''
 coords.heading = ''
 post_position(coords)
}

async function hashSHA256(input) {
 const utf8Bytes = new TextEncoder().encode(input)
 const hashBuffer = await crypto.subtle.digest('SHA-256', utf8Bytes)
 const hashArray = Array.from(new Uint8Array(hashBuffer))
 const hashHex = hashArray.map(byte => byte.toString(16).padStart(2, '0')).join('')
 return hashHex
}

async function encode_map_name(map_name) {
 let ename = await hashSHA256(map_name)
 let map_url = `./maps/${ename}.csv`
 return map_url
}
 
async function fetch_map() {
 if (!gPERMIT_FEED) {
  setTimeout(fetch_map, jitter(gFEED_POLL))
  return
 }
 var map_name = document.getElementById('map_name_input').value
 let map_url = await encode_map_name(map_name)
 fetch(map_url, {
  method: 'GET',
  headers: { 'Content-Type': 'text/plain' }
  })
  .then(response => response.text())
  .then(async data => {
   if (data) {
    await render_map_layer(data)
    if (gFEED_POLL > 5000)
     gFEED_POLL = 5000
   }
   setTimeout(fetch_map, jitter(gFEED_POLL))
  })
  .catch((error) => {
   console.log(error)
   status_msg('Map Request Failure.')
   remove_map_layer()
   if (gFEED_POLL < 60000)
    gFEED_POLL *= 2
   setTimeout(fetch_map, jitter(gFEED_POLL))
  })
}

async function render_map_layer(data) {
 let data_parsed = parse(data)
 let passphrase = get_passphrase()
 let map_name = document.getElementById('map_name_input').value

 if (passphrase && data_parsed.length > 0) {
  // Decrypt rows that are encrypted
  try {
   let salt = mapSalt(map_name)
   let key = await deriveKey(passphrase, salt)
   let decrypted = []
   for (let row of data_parsed) {
    // All stored rows have 8 fields: [..., timestamp, mode]
    // where mode is 'enc' or 'plain'
    if (row.length >= 8 && row[7] === 'enc') {
     let label   = row[0]  // plaintext - no decryption needed
     let lat     = await decryptField(key, row[1])
     let lon     = await decryptField(key, row[2])
     let acc     = await decryptField(key, row[3])
     let speed   = await decryptField(key, row[4])
     let heading = await decryptField(key, row[5])
     if (lat !== null && lon !== null) {
      decrypted.push([label, lat, lon, acc, speed, heading])
     }
     // If decryption fails (null), skip row (wrong passphrase)
    } else if (row.length >= 8 && row[7] === 'plain') {
     // Plain row on an encrypted map - show as-is
     decrypted.push([row[0], row[1], row[2], row[3], row[4], row[5]])
    }
   }
   remove_map_layer()
   add_map_layer(decrypted)
  } catch(e) {
   console.error('Decryption error:', e)
   status_msg('Decryption error - check passphrase')
  }
 } else {
  remove_map_layer()
  add_map_layer(data_parsed)
 }
}

function remove_map_layer() {
 try { gMAP.removeLayer(gMAP_MARKER_LAYER) } catch(e) {}
}

function add_map_layer(data) {
 if (!data) return
 var markers = []
 var this_label_list = []
 for (let i = 0; i < data.length; i++) {
  let p = data[i]
  let lat = parseFloat(p[1])
  let lng = parseFloat(p[2])
  if (!isFinite(lat) || !isFinite(lng)) continue
  this_label_list.push(p[0])
  let m1 = makeMarker(
   p[0],
   lat,
   lng,
   p[3],
   p[4],
   p[5],
   gLAST_LATITUDE,
   gLAST_LONGITUDE)
  markers.push(m1)
 }
 gMAP_MARKER_LAYER = L.featureGroup(markers)
 gMAP_MARKER_LAYER.addTo(gMAP)
 if (gIS_TRACKING) {
  if (gMAP_MARKER_LAYER) {
   let bounds = gMAP_MARKER_LAYER.getBounds()
   flyToBounds(bounds)
  }
 }
 compare_labels(this_label_list)
}

function makeMarker(map_label, lat, lng, accuracy, speed, heading, ref_lat, ref_lng) {

 let s = document.createElementNS("http://www.w3.org/2000/svg", "svg")
 s.setAttribute('xmlns', "http://www.w3.org/2000/svg")
 s.setAttribute('width', '40px')
 s.setAttribute('height', '40px')
 s.setAttribute('viewBox', "0 0 50 50")
 s.setAttribute('overflow', "visible")

 let c = document.createElementNS("http://www.w3.org/2000/svg", "circle")
 c.setAttribute('cx', "25")
 c.setAttribute('cy', "25")
 c.setAttribute('r', "12")
 c.setAttribute('fill', "cyan")
 c.setAttribute('stroke', "black")
 c.setAttribute('stroke-width', "1")
 s.appendChild(c)

 if (heading) {
  try { heading = parseInt(heading) } catch(e) { heading = null }
  if ((heading) || (heading == 0)) {
   let b = document.createElementNS("http://www.w3.org/2000/svg", "path")
   b.setAttribute('d', "M 0 -10 L -6 8 Q 0 2 6 8 L 0 -10 z")
   b.setAttribute('fill', "black")
   b.setAttribute('stroke', "none")
   b.setAttribute('transform',`translate(25 25) rotate(${heading})`)
   s.appendChild(b)
  }
 }
 
 if (map_label) {
  map_label = map_label.trim()
  let u = document.createElementNS("http://www.w3.org/2000/svg", "text")
  u.setAttribute('x', "45")
  u.setAttribute('y', "20") 
  u.setAttribute('font', "Verdana, sans-serif")
  u.setAttribute('font-size', "24")
  u.setAttribute('font-weight', "bolder")
  u.setAttribute('fill', "black")
  u.setAttribute('stroke', "none")
  u.setAttribute('class', "shadow")
  u.appendChild(document.createTextNode(map_label))
  s.appendChild(u)
 }

 var vert_offset = 42 
 if (accuracy) {
  let a = document.createElementNS("http://www.w3.org/2000/svg", "text")
  a.setAttribute('x', "45")
  a.setAttribute('y', vert_offset) 
  vert_offset += 18 
  a.setAttribute('font', "Verdana, sans-serif")
  a.setAttribute('font-size', "16")
  a.setAttribute('font-weight', "bolder")
  a.setAttribute('fill', "black")
  a.setAttribute('stroke', "none")
  a.setAttribute('class', "shadow")
  var speed_literal = ''
  if (speed)
   speed_literal = `, ${formatSpeed(speed)}`
  a.appendChild(document.createTextNode(`\u00B1${formatDistance(accuracy)}${speed_literal}`))
  s.appendChild(a)
 }

 if ((ref_lat) && (ref_lng) && (map_label != localStorage['map_label'])) {
  let v = distVincenty(ref_lat, ref_lng, lat, lng)
  if (v != 0) {
   let d = v.distance
   if (d > 100) {
    let b = document.createElementNS("http://www.w3.org/2000/svg", "text")
    b.setAttribute('x', "45")
    b.setAttribute('y', vert_offset) 
    b.setAttribute('font', "Verdana, sans-serif")
    b.setAttribute('font-size', "16")
    b.setAttribute('font-weight', "bolder")
    b.setAttribute('fill', "black")
    b.setAttribute('stroke', "none")
    b.setAttribute('class', "shadow")
    b.appendChild(document.createTextNode(`${formatDistance(d)} ${formatBearing(v.finalBearing)}`))
    s.appendChild(b)
   }
  }
 }

 let latlng = [lat, lng]
 let i = new L.divIcon({html: s, 
                        iconSize: new L.Point(40, 40), 
                        iconAnchor: new L.Point(20, 20), 
                        className: "borderless"})
 let m = new L.marker(latlng, {icon: i})
 return m
}

function flyToBounds(bounds) {
 gPROGRAMATIC_MOVE = true
 gMAP.flyToBounds(bounds, { maxZoom: 22 })
}

function track_warning() {
 status_msg('Tracking will resume in 60 seconds')
}

function post_event_track_resume() {
 close_all_dialogs()
 gPERMIT_POLL = true
 var bounds = null
 if (gMAP_MARKER_LAYER)
  bounds = gMAP_MARKER_LAYER.getBounds()
 if (!bounds) {
  track_resume()
  return
 }
 gPROGRAMATIC_MOVE = true
 try { clearTimeout(gTRACKING_WARNING_TIMEOUT); } catch(e) {}
 try { clearTimeout(gTRACKING_RESUME_TIMEOUT); } catch(e) {}
 flyToBounds(bounds)
 track_resume()
}

function track_resume() {
 status_msg('Resuming Tracking')
 gIS_TRACKING = true
}

function get_differences(referenceArray, newArray) {
 const newEntries = newArray.filter(item => !referenceArray.includes(item))
 const removedEntries = referenceArray.filter(item => !newArray.includes(item))
 return { newEntries, removedEntries }
}

function compare_labels(this_label_list) {
 if (gUSER_LIST.length != 0) {
  let gus = gUSER_LIST.sort()
  let us = this_label_list.sort()
  let diffs = get_differences(gus, us)
  diffs['newEntries'].forEach(u => { status_msg(`${u} Joined`) })
  diffs['removedEntries'].forEach(u => { status_msg(`${u} Left`) })
 } else {
  let labels = this_label_list.join('; ')
  status_msg(`Connected: ${labels}`)
 }
 gUSER_LIST = this_label_list
}

function formatDistance(distance) {
 if (distance < 1000)
  return `${parseFloat(distance).toFixed(0)}m`
 else if (distance < 10000)
  return `${parseFloat(distance/1000).toFixed(2)}km`
 else if (distance < 100000)
  return `${parseFloat(distance/1000).toFixed(1)}km`
 else
  return `${parseFloat(distance/1000).toFixed(0)}km`
}

function formatBearing(bearing) {
 try { bearing = parseInt(bearing) } catch(e) { bearing = null }
 if ((!bearing) && (bearing != 0))
  return ''
 return `${bearing.toString()}\u00B0`
}

function formatSpeed(speed) {
 if ((!speed) && (speed != 0))
  return ''
 const threshold = 10
 speed = parseFloat(speed)
 if (speed < threshold)
  return `${(speed.toFixed(2))}m/s`
 else {
  const kmh = speed * 3.6
  return `${(kmh.toFixed(0))}km/h`
 }
}

let wakeLock = null

const requestWakeLock = async () => {
 try {
  wakeLock = await navigator.wakeLock.request()
  wakeLock.addEventListener('release', () => {})
 } catch (err) {}
}
 
document.addEventListener('visibilitychange', async () => {
 if (wakeLock !== null && document.visibilityState === 'visible') {
  requestWakeLock()
 }
})
 
requestWakeLock()

let gDEFERRED_INSTALL_PROMPT

window.addEventListener('beforeinstallprompt', (e) => {
 e.preventDefault()
 gDEFERRED_INSTALL_PROMPT = e
})

function add_to_home_screen() {
 if (!gDEFERRED_INSTALL_PROMPT) {
  status_msg("Install Failed.  This app may already be installed.")
  return
 }
 gDEFERRED_INSTALL_PROMPT.prompt()
 gDEFERRED_INSTALL_PROMPT.userChoice.then((choiceResult) => {
  if (choiceResult.outcome === 'accepted') {}
 })
 gDEFERRED_INSTALL_PROMPT = null
}

window.onload = map_startup
