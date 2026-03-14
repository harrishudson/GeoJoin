<?php

// -------------------------------------------------------
// Configuration
// -------------------------------------------------------
$MAX_MAPS                  = 500;
$MAX_USERS_PER_MAP         = 15;
$REMOVE_INACTIVE_USERS_AGE = 90;   // seconds
$MAX_MAP_AGE               = 1800; // 30 minutes
$IP_THROTTLE_SECONDS       = 10;   // min gap between new-map creations from same IP

// -------------------------------------------------------
// Payload size limits
//
// Plain mode field maxima (characters):
//   map_name : 40
//   label    : 40
//   latitude : 20  e.g. "-43.54871236541298" (full browser GPS precision)
//   longitude: 20  e.g. "172.63549812743650"
//   accuracy : 12
//   speed    : 12
//   heading  : 12
//
// Encrypted mode:
//   field 1  : plaintext label (max 40 chars, needed for deduplication)
//   fields 2-6: AES-GCM base64 geo values
//              ceil((12+15+16)/3)*4 = 60 chars -> cap 64
//   field 7  : 'enc' sentinel (3 chars)
//
// Overall POST body ceilings:
//   Plain mode     : 300 bytes  (worst case ~162)
//   Encrypted mode : 450 bytes  (worst case ~423)
//   Hard ceiling   : 512 bytes  (checked before mode is known)
// -------------------------------------------------------

define('MAX_MAP_NAME_LEN',  40);
define('MAX_LABEL_LEN',     40);
define('MAX_LAT_LEN',       20);
define('MAX_LON_LEN',       20);
define('MAX_ACC_LEN',       12);  // e.g. "10000.123456"
define('MAX_SPEED_LEN',     12);
define('MAX_HEADING_LEN',   12);
define('MAX_ENC_GEO_LEN',   64);

// -------------------------------------------------------
// Helpers
// -------------------------------------------------------

function encode_map_name($map_name) {
    $input = mb_convert_encoding($map_name, 'UTF-8');
    return hash('sha256', $input);
}

function ip_throttle($throttle_seconds) {
    $lock_file   = './maps/.remote_addr_lock.txt';
    $remote_addr = $_SERVER['REMOTE_ADDR'] ?? '';
    if (strlen($remote_addr) < 1) return false;
    $remote_addr_hash = hash('sha256', $remote_addr);
    $stored_data = file_exists($lock_file) ? (string)file_get_contents($lock_file) : '';
    $parts       = explode(':', $stored_data, 2);
    $stored_hash = $parts[0] ?? '';
    $stored_time = isset($parts[1]) ? (int)$parts[1] : 0;
    $now         = time();
    if ($remote_addr_hash === $stored_hash && ($now - $stored_time) < $throttle_seconds) {
        return true;
    }
    file_put_contents($lock_file, $remote_addr_hash . ':' . $now);
    return false;
}

function do_map_cleanup($max_maps, $max_map_age) {
    $files = [];
    foreach (glob('./maps/*.csv') as $file) {
        $files[$file] = filemtime($file);
    }
    arsort($files);
    $i = 0;
    foreach (array_keys($files) as $file) {
        $i++;
        if ($i > $max_maps) @unlink($file);
    }
    $too_old = time() - $max_map_age;
    foreach (glob('./maps/*.csv') as $file) {
        if (filemtime($file) < $too_old) @unlink($file);
    }
}

function is_valid_base64($str, $max_len) {
    $len = strlen($str);
    if ($len < 1 || $len > $max_len) return false;
    return (bool)preg_match('/^[A-Za-z0-9+\/]+=*$/', $str);
}

function is_valid_geo_field($str, $max_len) {
    if (strlen($str) === 0) return true;
    if (strlen($str) > $max_len) return false;
    return (bool)preg_match('/^-?[0-9]+(\.[0-9]+)?$/', $str);
}

// -------------------------------------------------------
// Begin response
// -------------------------------------------------------
header('Content-Type: text/plain');

$input     = (string)file_get_contents('php://input');
$input_len = strlen($input);

// -------------------------------------------------------
// No-payload: cleanup-only mode (1-in-10 chance)
// -------------------------------------------------------
if ($input_len < 1) {
    if (rand(1, 10) === 1) {
        do_map_cleanup($MAX_MAPS, $MAX_MAP_AGE);
    }
    echo 'ok';
    exit;
}

// -------------------------------------------------------
// Hard ceiling before any parsing
// -------------------------------------------------------
if ($input_len > 512) {

    http_response_code(400);
    echo 'fail';
    exit;
}

// -------------------------------------------------------
// Parse exactly one CSV row
// -------------------------------------------------------
$rows    = array_map('str_getcsv', explode("\n", $input));
$payload = null;
foreach ($rows as $row) {
    $payload = $row;
    break;
}
if ($payload === null) {

    http_response_code(400);
    echo 'fail';
    exit;
}

$payload_size = count($payload);
if ($payload_size !== 7 && $payload_size !== 8) {

    http_response_code(400);
    echo 'fail';
    exit;
}

$is_encrypted = ($payload_size === 8);

// Tighten ceiling per mode now that we know which it is:
//   Plain mode     : 300 bytes  (worst case ~172 with 20-char lat/lon)
//   Encrypted mode : 450 bytes  (worst case ~423)
if (!$is_encrypted && $input_len > 300) {

    http_response_code(400);
    echo 'fail';
    exit;
}
if ($is_encrypted && $input_len > 450) {

    http_response_code(400);
    echo 'fail';
    exit;
}

// -------------------------------------------------------
// Validate map_name (field 0)
// -------------------------------------------------------
$map_name     = $payload[0];
$map_name_len = function_exists('mb_strlen') ? mb_strlen($map_name, 'UTF-8') : strlen($map_name);
if ($map_name_len < 10 || $map_name_len > MAX_MAP_NAME_LEN) {

    http_response_code(400);
    echo 'fail';
    exit;
}

// -------------------------------------------------------
// Validate 'enc' sentinel
// -------------------------------------------------------
if ($is_encrypted && $payload[7] !== 'enc') {

    http_response_code(400);
    echo 'fail';
    exit;
}

// -------------------------------------------------------
// Per-field validation
// -------------------------------------------------------
if ($is_encrypted) {
    $map_label     = $payload[1];
    $map_label_len = strlen(trim($map_label));
    if ($map_label_len < 1 || $map_label_len > MAX_LABEL_LEN) {
    
        http_response_code(400);
        echo 'fail';
        exit;
    }
    $enc_limits = [
        2 => MAX_ENC_GEO_LEN,
        3 => MAX_ENC_GEO_LEN,
        4 => MAX_ENC_GEO_LEN,
        5 => MAX_ENC_GEO_LEN,
        6 => MAX_ENC_GEO_LEN,
    ];
    foreach ($enc_limits as $idx => $max) {
        if (!is_valid_base64($payload[$idx], $max)) {
            http_response_code(400);
            echo 'fail';
            exit;
        }
    }
} else {
    $map_label     = $payload[1];
    $map_label_len = strlen(trim($map_label));
    if ($map_label_len < 1 || $map_label_len > MAX_LABEL_LEN) {
    
        http_response_code(400);
        echo 'fail';
        exit;
    }
    if (!is_valid_geo_field($payload[2], MAX_LAT_LEN) || strlen($payload[2]) < 1) {
    
        http_response_code(400);
        echo 'fail';
        exit;
    }
    if (!is_valid_geo_field($payload[3], MAX_LON_LEN) || strlen($payload[3]) < 1) {
    
        http_response_code(400);
        echo 'fail';
        exit;
    }
    foreach ([4 => MAX_ACC_LEN, 5 => MAX_SPEED_LEN, 6 => MAX_HEADING_LEN] as $idx => $max) {
        if (!is_valid_geo_field($payload[$idx], $max)) {
        
            http_response_code(400);
            echo 'fail';
            exit;
        }
    }
}

// -------------------------------------------------------
// Open / create map file
// -------------------------------------------------------
$encoded_map_name = encode_map_name($map_name);
$map_file         = './maps/' . $encoded_map_name . '.csv';

$fsize = 0;
if (file_exists($map_file)) {
    $fp    = fopen($map_file, 'r+');
    $fsize = filesize($map_file);
} else {
    if (ip_throttle($IP_THROTTLE_SECONDS)) {
    
        http_response_code(429);
        echo 'fail';
        exit;
    }
    $fp = fopen($map_file, 'w+');
}

if (!$fp) {

    http_response_code(500);
    echo 'fail';
    exit;
}

// -------------------------------------------------------
// Write user row under exclusive lock
//
// Stored CSV row format (always 8 fields):
//   [0] label        - plaintext in both modes
//   [1] lat          - plaintext or base64 AES-GCM
//   [2] lon          - plaintext or base64 AES-GCM
//   [3] accuracy     - plaintext or base64 AES-GCM
//   [4] speed        - plaintext or base64 AES-GCM
//   [5] heading      - plaintext or base64 AES-GCM
//   [6] timestamp    - unix timestamp (always plaintext)
//   [7] mode         - 'plain' or 'enc'
// -------------------------------------------------------
if (flock($fp, LOCK_EX)) {

    if ($is_encrypted) {
        $this_user_data = [
            $payload[1], $payload[2], $payload[3],
            $payload[4], $payload[5], $payload[6],
            time(), 'enc'
        ];
    } else {
        $this_user_data = [
            $payload[1], $payload[2], $payload[3],
            $payload[4], $payload[5], $payload[6],
            time(), 'plain'
        ];
    }

    if ($fsize !== 0) {
        $db_raw_read = fread($fp, $fsize);
        $db_read     = array_map('str_getcsv', explode("\n", $db_raw_read));

        // Remove existing row for this label
        foreach ($db_read as $i => $row) {
            if (isset($row[0]) && $row[0] === $map_label) {
                array_splice($db_read, $i, 1);
                break;
            }
        }

        // Trim to MAX_USERS_PER_MAP (keep most recently active)
        $timestamps = [];
        foreach ($db_read as $i => $row) {
            $timestamps[$i] = isset($row[6]) ? (int)$row[6] : 0;
        }
        arsort($timestamps);
        $keep    = array_flip(array_slice(array_keys($timestamps), 0, $MAX_USERS_PER_MAP));
        $db_read = array_values(array_intersect_key($db_read, $keep));

        // Remove inactive users
        $too_old = time() - $REMOVE_INACTIVE_USERS_AGE;
        $db_read = array_values(array_filter($db_read, function($row) use ($too_old) {
            return isset($row[6]) && (int)$row[6] >= $too_old;
        }));
    } else {
        $db_read = [];
    }

    $db_read[] = $this_user_data;

    ftruncate($fp, 0);
    rewind($fp);
    foreach ($db_read as $fields) {
        if (count($fields) >= 8) {
            fputcsv($fp, $fields);
        }
    }
    fflush($fp);
    flock($fp, LOCK_UN);

} else {
    fclose($fp);

    http_response_code(503);
    echo 'fail';
    exit;
}
fclose($fp);

// Opportunistic cleanup (1-in-20)
if (rand(1, 20) === 1) {
    do_map_cleanup($MAX_MAPS, $MAX_MAP_AGE);
}

echo 'ok';
?>
