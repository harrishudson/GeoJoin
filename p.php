<?php

$MAX_MAPS = 3000;
$MAX_USERS_PER_MAP = 15;
$REMOVE_INACTIVE_USERS_AGE = 90;
$MAX_MAP_AGE = 300;

function encode_map_name($map_name) {
 $input = mb_convert_encoding($map_name, 'UTF-8');
 return hash('sha256', $input);
}

function ip_throttle() {
 $LOCK_FILE = './maps/.remote_addr_lock.txt';
 $remote_addr = $_SERVER['REMOTE_ADDR'];
 if (strlen($remote_addr) < 1) {
  return false;
 }; 
 $remote_addr_hash = hash('sha256', $remote_addr);
 if (strlen($remote_addr_hash) < 1) {
  return false;
 };
 $stored_hash = '';
 if (file_exists($LOCK_FILE)) {
  $stored_hash = file_get_contents($LOCK_FILE);
 } else {
  file_put_contents($LOCK_FILE, $remote_addr_hash);
  return false;
 }
 if (strlen($stored_hash) < 1) {
  file_put_contents($LOCK_FILE, $remote_addr_hash);
  return false;
 }
 if ($remote_addr_hash <> $stored_hash) {
  file_put_contents($LOCK_FILE, $remote_addr_hash);
  return false;
 }
 $mtime = filemtime($LOCK_FILE);
 if ($mtime == time()) {
  return true;
 };
 file_put_contents($LOCK_FILE, $remote_addr_hash);
 return false;
}

header('Content-Type: text/plain');

$input = file_get_contents('php://input');

if (($input) && (!is_string($input))) {
 echo 'fail';
 exit;
};

$input_len = strlen($input); 
if (($input_len < 1) or ($input_len > 360)) {
 echo 'fail';
 exit;
};

$data = [];
if ($input) {
 $rows = array_map('str_getcsv', explode("\n", $input));
 $have_first_row = false;
 foreach ($rows as $row) {
  if ($have_first_row) {
   break;
  }
  $data[] = $row;
  $have_first_row = true;
 }
}

if (sizeof($data) <> 1) {
 echo 'fail';
 exit;
};

$payload = $data[0];

if (sizeof($payload) <> 7) {
 echo 'fail';
 exit;
};

$map_label = $payload[1];
$map_label_trim = trim($map_label);
$map_label_len = strlen($map_label_trim); 
if (($map_label_len < 1) or ($map_label_len > 40)) {
 echo 'fail';
 exit;
};

$map_name = $payload[0];
$map_name_len = strlen($map_name);
if (($map_name_len < 10) or ($map_name_len > 40)) {
 echo 'fail';
 exit;
};

$encoded_map_name = encode_map_name($map_name);
$map_file = './maps/' . $encoded_map_name . '.csv';

$db_data = array();

$fsize = 0;
if (file_exists($map_file)) {
 $fp = fopen($map_file, "r+");
 $fsize = filesize($map_file);
} else {
 if (ip_throttle()) {
  echo 'fail';
  exit;
 }
 $fp = fopen($map_file, "w+");
};

if (flock($fp, LOCK_EX)) {
 $this_user_data = array($payload[1], $payload[2], $payload[3], $payload[4], 
                         $payload[5], $payload[6], time());
 if ($fsize <> 0) {
  $db_raw_read = fread($fp, $fsize);
  $db_read = array_map('str_getcsv', explode("\n", $db_raw_read));
  $i = 0;
  $break_index = array();
  while ($i < sizeof($db_read)) {
   if ($db_read[$i][0] == $map_label) {
    array_push($break_index, $i);
    break;
   };
   $i+= 1;
  };
  foreach ($break_index as $i) {
   array_splice($db_read, $i, 1);
  };
  $people = array();    
  $i = 0;
  while ($i < sizeof($db_read)) {
   $people[$i] = $db_read[$i][6];
   $i+= 1;
  };
  arsort($people);
  $scan_people = array_keys($people);
  $i = 0;
  while ($i < sizeof($scan_people)) {
   if ($i > $MAX_USERS_PER_MAP) {
    array_splice($db_read, $scan_people[$i], 1);
   };
   $i+= 1;
  };
  $too_old = time() - $REMOVE_INACTIVE_USERS_AGE;
  $i = 0;
  while ($i < sizeof($db_read)) {
   if ($db_read[$i][6] < $too_old) {
    array_splice($db_read, $i, 1);
   }
   $i+= 1;
  };
 } else {
  $db_read = array(); 
 };
 array_push($db_read, $this_user_data);
 ftruncate($fp, 0);
 rewind($fp);
 foreach ($db_read as $fields) {
  if (sizeof($fields) == 7) {
   fputcsv($fp, $fields);
  };
 };
 fflush($fp);
 flock($fp, LOCK_UN);
} else {
 echo 'fail';
 exit;
};

$files = array();    
foreach (glob("./maps/*.csv") as $file) {
 $files[$file] = filemtime($file);
};
arsort($files);
$scan_files = array_keys($files);
$i = 0;
foreach($scan_files as $file) {
 $i+= 1;
 if ($i > $MAX_MAPS) {
  unlink($file);
 };
};

$files = array();    
$too_old = time() - $MAX_MAP_AGE;
foreach (glob("./maps/*.csv") as $file) {
 $ftime = filemtime($file);
 if ($ftime < $too_old) {
  unlink($file);
 };
};

echo 'ok';
?>
