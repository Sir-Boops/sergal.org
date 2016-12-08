<?php

//Set the host IP
if($_SERVER['X-Real-IP'] == null){
  $user_IP = $_SERVER['REMOTE_ADDR'];
} else {
  $user_IP = $_SERVER['X-Real-IP'];
}

//Check if IPv4 or IPv6
if(strpos($user_IP, ".") === false){
  //It's IPv6
  $ip_hello = str_replace("%userip%", $user_IP, '<h3 class="pure-u-1-1 text">Hello %userip%, I see you are using IPv6. Thank you.</h3>');
} else {
  //It's IPv4
  $ip_hello = str_replace("%userip%", $user_IP, '<h3 class="pure-u-1-1 text">Hello %userip%, I see you are using IPv4. You should really look into IPv6.</h3>');
}

$index = str_replace("%ip_message%", $ip_hello, file_get_contents("assets/html.html"));

echo $index;

 ?>
