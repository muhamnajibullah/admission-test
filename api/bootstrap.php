<?php

declare(strict_types=1);

ini_set('display_errors', '0');
error_reporting(E_ALL);

const APP_ROOT = __DIR__ . '/..';
const UPLOAD_ROOT = APP_ROOT . '/storage/uploads/questions';
date_default_timezone_set('Asia/Jakarta');

$databaseConfig = require APP_ROOT . '/config/database.example.php';
$configFile = APP_ROOT . '/config/database.php';
if (is_file($configFile)) {
    $override = require $configFile;
    if (is_array($override)) {
        $databaseConfig = array_replace($databaseConfig, array_intersect_key($override, $databaseConfig));
    }
}

function database(): PDO
{
    static $pdo = null;
    global $databaseConfig;
    if ($pdo instanceof PDO) {
        return $pdo;
    }
    $dsn = sprintf('mysql:host=%s;port=%s;dbname=%s;charset=utf8mb4', $databaseConfig['host'], $databaseConfig['port'], $databaseConfig['name']);
    $pdo = new PDO($dsn, $databaseConfig['user'], $databaseConfig['pass'], [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        PDO::ATTR_EMULATE_PREPARES => false,
    ]);
    $pdo->exec("SET time_zone = '+07:00'");
    return $pdo;
}

function sendJson(int $status, array $data): void
{
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    echo json_encode($data, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
    exit;
}

function bodyJson(): array
{
    if ((int) ($_SERVER['CONTENT_LENGTH'] ?? 0) > 1048576) {
        sendJson(413, ['success' => false, 'message' => 'Request body is too large.']);
    }
    $value = json_decode((string) file_get_contents('php://input'), true);
    return is_array($value) ? $value : [];
}

function routePath(): string
{
    $path = isset($_SERVER['PATH_INFO']) ? (string) $_SERVER['PATH_INFO'] : '';
    if ($path === '') {
        $path = isset($_GET['route']) ? '/' . ltrim((string) $_GET['route'], '/') : '/';
    }
    return '/' . trim($path, '/');
}

final class DatabaseSessionHandler implements SessionHandlerInterface
{
    private $pdo;

    public function __construct(PDO $pdo)
    {
        $this->pdo = $pdo;
    }

    public function open($savePath, $sessionName)
    {
        return true;
    }

    public function close()
    {
        return true;
    }

    public function read($sessionId)
    {
        $stmt = $this->pdo->prepare('SELECT session_data FROM admin_sessions WHERE session_id = :id');
        $stmt->execute([':id' => (string) $sessionId]);
        $data = $stmt->fetchColumn();
        return $data === false ? '' : (string) $data;
    }

    public function write($sessionId, $data)
    {
        $stmt = $this->pdo->prepare(
            'INSERT INTO admin_sessions (session_id, session_data, last_activity) VALUES (:id, :data, NOW()) '
            . 'ON DUPLICATE KEY UPDATE session_data = VALUES(session_data), last_activity = NOW()'
        );
        return $stmt->execute([':id' => (string) $sessionId, ':data' => (string) $data]);
    }

    public function destroy($sessionId)
    {
        $stmt = $this->pdo->prepare('DELETE FROM admin_sessions WHERE session_id = :id');
        return $stmt->execute([':id' => (string) $sessionId]);
    }

    public function gc($maxLifetime)
    {
        $cutoff = date('Y-m-d H:i:s', time() - max(1, (int) $maxLifetime));
        $stmt = $this->pdo->prepare('DELETE FROM admin_sessions WHERE last_activity < :cutoff');
        $stmt->execute([':cutoff' => $cutoff]);
        return $stmt->rowCount();
    }
}

function startSecureSession(): void
{
    if (session_status() === PHP_SESSION_ACTIVE) {
        return;
    }
    ini_set('session.use_only_cookies', '1');
    ini_set('session.use_strict_mode', '1');
    session_name('admission_admin');
    session_set_cookie_params([
        'lifetime' => 0,
        'path' => '/',
        'secure' => !empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off',
        'httponly' => true,
        'samesite' => 'Lax',
    ]);
    session_set_save_handler(new DatabaseSessionHandler(database()), true);
    session_start();
}

function currentAdmin(): array
{
    startSecureSession();
    if (empty($_SESSION['admin_id'])) {
        sendJson(401, ['success' => false, 'message' => 'Authentication required.']);
    }
    return ['id' => (int) $_SESSION['admin_id'], 'email' => (string) $_SESSION['admin_email'], 'name' => (string) $_SESSION['admin_name']];
}

function requireCsrf(): void
{
    startSecureSession();
    $sent = isset($_SERVER['HTTP_X_CSRF_TOKEN']) ? (string) $_SERVER['HTTP_X_CSRF_TOKEN'] : '';
    if (empty($_SESSION['csrf']) || !hash_equals((string) $_SESSION['csrf'], $sent)) {
        sendJson(403, ['success' => false, 'message' => 'Invalid security token. Refresh the page and try again.']);
    }
}

function textValue($value, int $max = 255): string
{
    $value = trim((string) $value);
    return function_exists('mb_substr') ? mb_substr($value, 0, $max) : substr($value, 0, $max);
}

function cleanRichText($html): string
{
    $html = (string) $html;
    if (trim($html) === '') {
        return '';
    }
    if (!class_exists('DOMDocument')) {
        $withBreaks = preg_replace('#<(?:br\s*/?|/p|/div)>#i', "\n", $html);
        return nl2br(htmlspecialchars(strip_tags((string) $withBreaks), ENT_QUOTES, 'UTF-8'));
    }
    $document = new DOMDocument('1.0', 'UTF-8');
    $previous = libxml_use_internal_errors(true);
    $document->loadHTML('<?xml encoding="utf-8" ?><div id="clean-root">' . $html . '</div>', LIBXML_HTML_NOIMPLIED | LIBXML_HTML_NODEFDTD);
    libxml_clear_errors();
    libxml_use_internal_errors($previous);
    $allowed = ['p', 'div', 'strong', 'b', 'em', 'i', 'u', 's', 'ul', 'ol', 'li', 'br'];
    $blocked = ['script', 'style', 'iframe', 'object', 'embed', 'svg', 'math', 'template'];
    $walk = function (DOMNode $node) use (&$walk, $allowed, $blocked): void {
        for ($child = $node->firstChild; $child !== null;) {
            $next = $child->nextSibling;
            if ($child instanceof DOMElement) {
                while ($child->attributes->length > 0) {
                    $child->removeAttributeNode($child->attributes->item(0));
                }
                $tag = strtolower($child->tagName);
                if (in_array($tag, $blocked, true)) {
                    $node->removeChild($child);
                } elseif (!in_array($tag, $allowed, true)) {
                    $walk($child);
                    while ($child->firstChild) {
                        $node->insertBefore($child->firstChild, $child);
                    }
                    $node->removeChild($child);
                } else {
                    $walk($child);
                }
            } elseif (!($child instanceof DOMText)) {
                $node->removeChild($child);
            }
            $child = $next;
        }
    };
    $root = $document->getElementById('clean-root');
    if (!$root) {
        return '';
    }
    $walk($root);
    $output = '';
    foreach ($root->childNodes as $child) {
        $output .= $document->saveHTML($child);
    }
    return $output;
}

function plainRichText(string $html): string
{
    return trim(html_entity_decode(strip_tags(str_replace(['<br>', '<br/>', '<br />'], "\n", $html)), ENT_QUOTES, 'UTF-8'));
}

function validImagePath($path): ?string
{
    $path = textValue($path, 255);
    if ($path === '') {
        return null;
    }
    if (!preg_match('#^storage/uploads/questions/[a-f0-9]{32}\.(jpg|png|webp)$#', $path)) {
        sendJson(422, ['success' => false, 'message' => 'Invalid question or answer image path.']);
    }
    return $path;
}

function randomHex(int $bytes = 32): string
{
    return bin2hex(random_bytes($bytes));
}
