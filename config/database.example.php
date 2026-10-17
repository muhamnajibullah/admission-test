<?php

// Local defaults work with a standard XAMPP/Laragon MySQL installation.
// Hosting can supply ADMISSION_DB_* environment variables or database.php overrides.
$environment = static function (string $name, string $fallback): string {
    $value = getenv($name);
    return $value === false || $value === '' ? $fallback : $value;
};

return [
    'host' => $environment('ADMISSION_DB_HOST', '127.0.0.1'),
    'port' => $environment('ADMISSION_DB_PORT', '3306'),
    'name' => $environment('ADMISSION_DB_NAME', 'alazkasch_admission_test'),
    'user' => $environment('ADMISSION_DB_USER', 'root'),
    'pass' => $environment('ADMISSION_DB_PASS', ''),
];
