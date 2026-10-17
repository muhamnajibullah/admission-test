<?php

declare(strict_types=1);
require_once __DIR__ . '/bootstrap.php';

$method = strtoupper((string) ($_SERVER['REQUEST_METHOD'] ?? 'GET'));
$path = routePath();
$pdo = null;

// Question banks are normalized in SQL and assembled only at the API boundary.
function loadBank(PDO $pdo, int $bankId, bool $withCorrect = true): array
{
    $stmt = $pdo->prepare('SELECT qb.*, u.name AS unit_name, u.city, (u.active_question_bank_id = qb.id) AS is_active FROM question_banks qb JOIN units u ON u.id = qb.unit_id WHERE qb.id = :id');
    $stmt->execute([':id' => $bankId]);
    $bank = $stmt->fetch();
    if (!$bank) {
        sendJson(404, ['success' => false, 'message' => 'Question bank not found.']);
    }
    $stmt = $pdo->prepare('SELECT id, content_html, image_path FROM questions WHERE question_bank_id = :id ORDER BY position, id');
    $stmt->execute([':id' => $bankId]);
    $questions = [];
    foreach ($stmt->fetchAll() as $question) {
        $optionStmt = $pdo->prepare('SELECT id, option_key, content_html, is_correct FROM question_options WHERE question_id = :id ORDER BY position, id');
        $optionStmt->execute([':id' => $question['id']]);
        $options = [];
        $optionImagePaths = [];
        $correct = '';
        foreach ($optionStmt->fetchAll() as $option) {
            $options[$option['option_key']] = $option['content_html'];
            $optionImageStmt = $pdo->prepare('SELECT image_path FROM question_option_images WHERE question_option_id = :id ORDER BY position, id');
            $optionImageStmt->execute([':id' => $option['id']]);
            $optionImagePaths[$option['option_key']] = array_column($optionImageStmt->fetchAll(), 'image_path');
            if ((int) $option['is_correct'] === 1) {
                $correct = $option['option_key'];
            }
        }
        $imageStmt = $pdo->prepare('SELECT image_path FROM question_images WHERE question_id = :id ORDER BY position, id');
        $imageStmt->execute([':id' => $question['id']]);
        $imagePaths = array_column($imageStmt->fetchAll(), 'image_path');
        if (!$imagePaths && $question['image_path']) {
            $imagePaths[] = $question['image_path'];
        }
        $item = ['id' => (int) $question['id'], 'content' => $question['content_html'], 'imagePath' => $imagePaths[0] ?? null, 'imagePaths' => $imagePaths, 'options' => $options, 'optionImagePaths' => $optionImagePaths];
        if ($withCorrect) {
            $item['correctOption'] = $correct;
        }
        $questions[] = $item;
    }
    return [
        'id' => (int) $bank['id'], 'unitId' => (int) $bank['unit_id'], 'unitName' => $bank['unit_name'], 'city' => $bank['city'],
        'title' => $bank['title'], 'passingScore' => (int) $bank['passing_score'], 'durationSeconds' => (int) $bank['duration_seconds'],
        'shuffleQuestions' => (bool) $bank['shuffle_questions'], 'shuffleOptions' => (bool) $bank['shuffle_options'],
        'isActive' => (bool) $bank['is_active'], 'questions' => $questions,
    ];
}

function normalizeQuestionImageMarkers(string $content, array $imagePaths): string
{
    $allowed = array_fill_keys($imagePaths, true);
    $represented = [];
    $normalized = preg_replace_callback(
        '#\[\[question-image:(storage/uploads/questions/[a-f0-9]{32}\.(?:jpg|png|webp))\]\]#',
        static function (array $match) use ($allowed, &$represented): string {
            if (!isset($allowed[$match[1]])) {
                return '';
            }
            $represented[$match[1]] = true;
            return $match[0];
        },
        $content
    );
    $normalized = is_string($normalized) ? $normalized : $content;
    foreach ($imagePaths as $imagePath) {
        if (!isset($represented[$imagePath])) {
            $normalized .= '[[question-image:' . $imagePath . ']]';
        }
    }
    return trim($normalized);
}

function normalizeAnswerImageMarkers(string $content, array $imagePaths): string
{
    $allowed = array_fill_keys($imagePaths, true);
    $represented = [];
    $normalized = preg_replace_callback(
        '#\[\[answer-image:(storage/uploads/questions/[a-f0-9]{32}\.(?:jpg|png|webp))\]\]#',
        static function (array $match) use ($allowed, &$represented): string {
            if (!isset($allowed[$match[1]])) {
                return '';
            }
            $represented[$match[1]] = true;
            return $match[0];
        },
        $content
    );
    $normalized = is_string($normalized) ? $normalized : $content;
    foreach ($imagePaths as $imagePath) {
        if (!isset($represented[$imagePath])) {
            $normalized .= '[[answer-image:' . $imagePath . ']]';
        }
    }
    return trim($normalized);
}

function saveBank(PDO $pdo, array $data, int $bankId = 0): int
{
    // Unit locking makes first-bank activation and concurrent saves deterministic.
    $unitId = (int) ($data['unitId'] ?? 0);
    $title = textValue($data['title'] ?? '', 160);
    $passing = (int) ($data['passingScore'] ?? 75);
    $duration = (int) ($data['durationSeconds'] ?? 0);
    $questions = isset($data['questions']) && is_array($data['questions']) ? $data['questions'] : [];
    if ($unitId < 1 || $title === '' || $passing < 0 || $passing > 100 || $duration < 60 || $duration > 28800 || !$questions || count($questions) > 200) {
        sendJson(422, ['success' => false, 'message' => 'Unit, title, 1–480 minute duration, passing score, and at least one question are required.']);
    }
    $pdo->beginTransaction();
    try {
        $unit = $pdo->prepare('SELECT id, active_question_bank_id FROM units WHERE id = :id FOR UPDATE');
        $unit->execute([':id' => $unitId]);
        $unitRow = $unit->fetch();
        if (!$unitRow) {
            throw new RuntimeException('Unit not found.');
        }
        if ($bankId > 0) {
            $owner = $pdo->prepare('SELECT unit_id FROM question_banks WHERE id=:id'); $owner->execute([':id'=>$bankId]);
            $ownerUnit = (int) $owner->fetchColumn();
            if (!$ownerUnit) { throw new RuntimeException('Question bank not found.'); }
            $isMoving = $ownerUnit !== $unitId;
            $targetBankCount = 0;
            if ($isMoving) {
                $countTargetBanks = $pdo->prepare('SELECT COUNT(*) FROM question_banks WHERE unit_id=:unit AND id<>:bank');
                $countTargetBanks->execute([':unit'=>$unitId, ':bank'=>$bankId]);
                $targetBankCount = (int) $countTargetBanks->fetchColumn();
                $pdo->prepare('UPDATE units SET active_question_bank_id=NULL WHERE id=:unit AND active_question_bank_id=:bank')->execute([':unit'=>$ownerUnit, ':bank'=>$bankId]);
            }
            $stmt = $pdo->prepare('UPDATE question_banks SET unit_id=:unit, title=:title, passing_score=:passing, duration_seconds=:duration, shuffle_questions=:sq, shuffle_options=:so WHERE id=:id');
            $stmt->execute([':unit'=>$unitId, ':title'=>$title, ':passing'=>$passing, ':duration'=>$duration, ':sq'=>!empty($data['shuffleQuestions'])?1:0, ':so'=>!empty($data['shuffleOptions'])?1:0, ':id'=>$bankId]);
            if ($stmt->rowCount() === 0) {
                $check = $pdo->prepare('SELECT COUNT(*) FROM question_banks WHERE id=:id'); $check->execute([':id'=>$bankId]);
                if ((int) $check->fetchColumn() === 0) { throw new RuntimeException('Question bank not found.'); }
            }
            if ($isMoving && $targetBankCount === 0 && $unitRow['active_question_bank_id'] === null) {
                $pdo->prepare('UPDATE units SET active_question_bank_id=:bank WHERE id=:unit')->execute([':bank'=>$bankId, ':unit'=>$unitId]);
            }
            $pdo->prepare('DELETE FROM questions WHERE question_bank_id=:id')->execute([':id'=>$bankId]);
        } else {
            $stmt = $pdo->prepare('INSERT INTO question_banks (unit_id,title,passing_score,duration_seconds,shuffle_questions,shuffle_options) VALUES (:unit,:title,:passing,:duration,:sq,:so)');
            $stmt->execute([':unit'=>$unitId, ':title'=>$title, ':passing'=>$passing, ':duration'=>$duration, ':sq'=>!empty($data['shuffleQuestions'])?1:0, ':so'=>!empty($data['shuffleOptions'])?1:0]);
            $bankId = (int) $pdo->lastInsertId();
            if ($unitRow['active_question_bank_id'] === null) {
                $pdo->prepare('UPDATE units SET active_question_bank_id=:bank WHERE id=:unit')->execute([':bank'=>$bankId, ':unit'=>$unitId]);
            }
        }
        foreach ($questions as $position => $question) {
            $content = cleanRichText($question['content'] ?? '');
            $options = isset($question['options']) && is_array($question['options']) ? $question['options'] : [];
            $rawImages = isset($question['imagePaths']) && is_array($question['imagePaths']) ? $question['imagePaths'] : [];
            if (!$rawImages && !empty($question['imagePath'])) { $rawImages[] = $question['imagePath']; }
            $imagePaths = [];
            foreach ($rawImages as $rawImage) {
                $imagePath = validImagePath($rawImage);
                if ($imagePath !== null && !in_array($imagePath, $imagePaths, true)) { $imagePaths[] = $imagePath; }
            }
            $content = normalizeQuestionImageMarkers($content, $imagePaths);
            $correct = strtoupper(textValue($question['correctOption'] ?? '', 1));
            if (plainRichText($content) === '' || strlen($content) > 20000 || count($options) !== 4 || count($imagePaths) > 10 || !in_array($correct, ['A','B','C','D'], true)) {
                throw new InvalidArgumentException('Every question requires content, four options, and one correct answer.');
            }
            $q = $pdo->prepare('INSERT INTO questions (question_bank_id,position,content_html,image_path) VALUES (:bank,:position,:content,:image)');
            $q->execute([':bank'=>$bankId, ':position'=>$position+1, ':content'=>$content, ':image'=>$imagePaths[0] ?? null]);
            $questionId = (int) $pdo->lastInsertId();
            $imageInsert = $pdo->prepare('INSERT INTO question_images (question_id,position,image_path) VALUES (:question,:position,:path)');
            foreach ($imagePaths as $imagePosition => $imagePath) {
                $imageInsert->execute([':question'=>$questionId, ':position'=>$imagePosition+1, ':path'=>$imagePath]);
            }
            foreach (['A','B','C','D'] as $optionPosition => $key) {
                $optionContent = cleanRichText($options[$key] ?? '');
                $rawOptionImages = isset($question['optionImagePaths'][$key]) && is_array($question['optionImagePaths'][$key]) ? $question['optionImagePaths'][$key] : [];
                $optionImages = [];
                foreach ($rawOptionImages as $rawOptionImage) {
                    $optionImagePath = validImagePath($rawOptionImage);
                    if ($optionImagePath !== null && !in_array($optionImagePath, $optionImages, true)) { $optionImages[] = $optionImagePath; }
                }
                $optionContent = normalizeAnswerImageMarkers($optionContent, $optionImages);
                if (plainRichText($optionContent) === '' || strlen($optionContent) > 10000 || count($optionImages) > 10) { throw new InvalidArgumentException('All answer options are required, may contain at most 10 images, and must be reasonably sized.'); }
                $o = $pdo->prepare('INSERT INTO question_options (question_id,option_key,position,content_html,is_correct) VALUES (:question,:key,:position,:content,:correct)');
                $o->execute([':question'=>$questionId, ':key'=>$key, ':position'=>$optionPosition+1, ':content'=>$optionContent, ':correct'=>$key===$correct?1:0]);
                $optionId = (int) $pdo->lastInsertId();
                $optionImageInsert = $pdo->prepare('INSERT INTO question_option_images (question_option_id,position,image_path) VALUES (:option,:position,:path)');
                foreach ($optionImages as $imagePosition => $optionImagePath) {
                    $optionImageInsert->execute([':option'=>$optionId, ':position'=>$imagePosition+1, ':path'=>$optionImagePath]);
                }
            }
        }
        $pdo->commit();
        return $bankId;
    } catch (Throwable $error) {
        if ($pdo->inTransaction()) { $pdo->rollBack(); }
        if ($error instanceof InvalidArgumentException || $error instanceof RuntimeException) {
            sendJson(422, ['success'=>false, 'message'=>$error->getMessage()]);
        }
        throw $error;
    }
}

function publicAttempt(array $row): array
{
    // Correct answer IDs never leave the server in an exam response.
    $snapshot = json_decode((string) $row['snapshot_json'], true);
    $answers = json_decode((string) ($row['answers_json'] ?: '{}'), true);
    $flagged = json_decode((string) ($row['flagged_json'] ?: '[]'), true);
    $questions = [];
    foreach ($snapshot['questions'] as $question) {
        $options = [];
        foreach ($question['options'] as $option) {
            $options[] = ['id'=>$option['id'], 'content'=>$option['content'], 'imagePaths'=>$option['imagePaths']??[]];
        }
        $questions[] = ['id'=>$question['id'], 'content'=>$question['content'], 'imagePath'=>$question['imagePath'] ?? null, 'imagePaths'=>$question['imagePaths'] ?? (!empty($question['imagePath']) ? [$question['imagePath']] : []), 'options'=>$options];
    }
    return ['id'=>$row['public_id'], 'registrationNumber'=>$row['registration_number'], 'fullName'=>$row['full_name'], 'unitName'=>$row['unit_name'], 'title'=>$snapshot['title'], 'startedAt'=>$row['started_at'], 'expiresAt'=>$row['expires_at'], 'status'=>$row['status'], 'answers'=>(object)(is_array($answers)?$answers:[]), 'flagged'=>is_array($flagged)?$flagged:[], 'questions'=>$questions];
}

function findAttempt(PDO $pdo, string $publicId, bool $lock = false): array
{
    $sql = 'SELECT ea.*, sa.registration_number, sa.full_name, u.name AS unit_name FROM exam_attempts ea JOIN student_applications sa ON sa.id=ea.application_id JOIN units u ON u.id=sa.unit_id WHERE ea.public_id=:id' . ($lock ? ' FOR UPDATE' : '');
    $stmt=$pdo->prepare($sql); $stmt->execute([':id'=>$publicId]); $row=$stmt->fetch();
    if(!$row){sendJson(404,['success'=>false,'message'=>'Exam attempt not found.']);}
    return $row;
}

function finalizeAttempt(PDO $pdo, array $row, array $answers): array
{
    // Scoring always uses the immutable attempt snapshot, not a later bank revision.
    $snapshot=json_decode((string)$row['snapshot_json'],true); $correct=0; $clean=[];
    foreach($snapshot['questions'] as $question){$answer=textValue($answers[$question['id']]??'',64);$clean[$question['id']]=$answer;if($answer!==''&&hash_equals($question['correctId'],$answer)){$correct++;}}
    $total=count($snapshot['questions']); $score=$total?(int)round($correct/$total*100):0;
    $stmt=$pdo->prepare("UPDATE exam_attempts SET answers_json=:answers,status='submitted',submitted_at=NOW(),score=:score,correct_count=:correct,wrong_count=:wrong WHERE id=:id AND status='in_progress'");
    $stmt->execute([':answers'=>json_encode($clean),':score'=>$score,':correct'=>$correct,':wrong'=>$total-$correct,':id'=>$row['id']]);
    return ['score'=>$score,'correctCount'=>$correct,'wrongCount'=>$total-$correct,'totalQuestions'=>$total,'passed'=>$score>=(int)$snapshot['passingScore']];
}

// Only snapshot-owned question and option IDs are accepted from the browser.
function cleanAttemptAnswers(array $row, array $answers): array
{
    $snapshot = json_decode((string) $row['snapshot_json'], true);
    $clean = [];
    foreach ($snapshot['questions'] as $question) {
        $submitted = textValue($answers[$question['id']] ?? '', 64);
        $allowed = array_map(static function (array $option): string { return (string) $option['id']; }, $question['options']);
        $clean[$question['id']] = in_array($submitted, $allowed, true) ? $submitted : '';
    }
    return $clean;
}

function validatedAttemptAnswers(array $row, array $data): array
{
    if (!array_key_exists('answers', $data) || !is_array($data['answers']) || !array_key_exists('answerCount', $data)) {
        throw new InvalidArgumentException('The answer payload is incomplete. Refresh the exam page and try again.');
    }
    $expected = filter_var($data['answerCount'], FILTER_VALIDATE_INT);
    $total = count(json_decode((string) $row['snapshot_json'], true)['questions'] ?? []);
    if ($expected === false || $expected < 0 || $expected > $total) {
        throw new InvalidArgumentException('The answer count is invalid. Refresh the exam page and try again.');
    }
    $clean = cleanAttemptAnswers($row, $data['answers']);
    $accepted = count(array_filter($clean, static function (string $answer): bool { return $answer !== ''; }));
    if ($accepted !== $expected) {
        throw new InvalidArgumentException('Some answers could not be verified and were not submitted. Refresh the exam page and check your answers.');
    }
    return $clean;
}

function cleanAttemptFlags(array $row, array $flags): array
{
    $snapshot = json_decode((string) $row['snapshot_json'], true);
    $allowed = array_map(static function (array $question): string { return (string) $question['id']; }, $snapshot['questions']);
    return array_values(array_unique(array_filter(array_map('strval', $flags), static function (string $id) use ($allowed): bool { return in_array($id, $allowed, true); })));
}

function examAccessContext(PDO $pdo, array $data, bool $allowPreviewGrant = false): array
{
    $registration = textValue($data['registrationNumber'] ?? '', 24);
    $token = preg_replace('/\D/', '', (string) ($data['token'] ?? ''));
    if (!preg_match('/^\d{4}$/', $token)) {
        sendJson(422, ['success' => false, 'message' => 'Enter the four-digit exam token.']);
    }
    $ipHash = hash('sha256', (string) ($_SERVER['REMOTE_ADDR'] ?? 'unknown'));
    $limit = $pdo->prepare('SELECT COUNT(*) FROM exam_access_attempts WHERE ip_hash=:ip AND attempted_at>DATE_SUB(NOW(),INTERVAL 10 MINUTE)');
    $limit->execute([':ip' => $ipHash]);
    if ((int) $limit->fetchColumn() >= 20) {
        sendJson(429, ['success' => false, 'message' => 'Too many token attempts. Try again later.']);
    }
    $tokenHash = hash('sha256', $token);
    $stmt = $pdo->prepare('SELECT et.id FROM exam_tokens et WHERE et.token_hash=:hash AND et.is_active=1 AND et.expires_at>NOW() ORDER BY id DESC LIMIT 1');
    $stmt->execute([':hash' => $tokenHash]);
    $tokenId = (int) $stmt->fetchColumn();
    $previewGrant = null;
    // A successful preview remains valid for this browser session even if the
    // short-lived global token expires before the candidate presses Start Test.
    if (!$tokenId && $allowPreviewGrant) {
        startSecureSession();
        $storedGrant = $_SESSION['exam_preview_grant'] ?? null;
        if (
            is_array($storedGrant)
            && hash_equals((string) ($storedGrant['registrationNumber'] ?? ''), $registration)
            && hash_equals((string) ($storedGrant['tokenHash'] ?? ''), $tokenHash)
        ) {
            $previewGrant = $storedGrant;
            $tokenId = (int) ($storedGrant['tokenId'] ?? 0);
        }
    }
    if (!$tokenId) {
        $pdo->prepare('INSERT INTO exam_access_attempts (ip_hash) VALUES (:ip)')->execute([':ip' => $ipHash]);
        sendJson(403, ['success' => false, 'message' => 'The exam token is invalid or expired.']);
    }
    $pdo->prepare('DELETE FROM exam_access_attempts WHERE ip_hash=:ip OR attempted_at<DATE_SUB(NOW(),INTERVAL 1 DAY)')->execute([':ip' => $ipHash]);
    $stmt = $pdo->prepare('SELECT sa.*,u.name AS unit_name,u.active_question_bank_id FROM student_applications sa JOIN units u ON u.id=sa.unit_id WHERE sa.registration_number=:r AND u.is_active=1');
    $stmt->execute([':r' => $registration]);
    $application = $stmt->fetch();
    if (!$application || !$application['active_question_bank_id']) {
        sendJson(404, ['success' => false, 'message' => 'Registration or active exam not found.']);
    }
    if (
        $previewGrant
        && (
            (int) ($previewGrant['applicationId'] ?? 0) !== (int) $application['id']
            || (int) ($previewGrant['questionBankId'] ?? 0) !== (int) $application['active_question_bank_id']
        )
    ) {
        sendJson(403, ['success' => false, 'message' => 'The exam preview is no longer valid. Enter the active token again.']);
    }
    return [
        'tokenId' => $tokenId,
        'tokenHash' => $tokenHash,
        'application' => $application,
        'bank' => loadBank($pdo, (int) $application['active_question_bank_id'], true),
    ];
}

function rememberExamPreviewGrant(array $access): void
{
    startSecureSession();
    // Bind the grant to the exact candidate, token, and question bank shown.
    $_SESSION['exam_preview_grant'] = [
        'registrationNumber' => (string) $access['application']['registration_number'],
        'applicationId' => (int) $access['application']['id'],
        'questionBankId' => (int) $access['bank']['id'],
        'tokenId' => (int) $access['tokenId'],
        'tokenHash' => (string) $access['tokenHash'],
    ];
}

function storeQuestionUpload(array $file): array
{
    $uploadError = (int) ($file['error'] ?? UPLOAD_ERR_NO_FILE);
    if (in_array($uploadError, [UPLOAD_ERR_INI_SIZE, UPLOAD_ERR_FORM_SIZE], true)) {
        sendJson(413, ['success' => false, 'message' => 'The image exceeds the hosting upload limit. Choose a smaller file or increase the PHP upload limit.']);
    }
    if ($uploadError !== UPLOAD_ERR_OK) {
        sendJson(422, ['success' => false, 'message' => 'The image upload was incomplete or could not be received by the server. Please try again.']);
    }
    $size = (int) ($file['size'] ?? 0);
    if ($size < 1 || $size > 20 * 1024 * 1024) {
        sendJson(422, ['success' => false, 'message' => 'Each source image must be 20 MB or smaller.']);
    }
    $info = @getimagesize((string) $file['tmp_name']);
    $types = [IMAGETYPE_JPEG => 'jpg', IMAGETYPE_PNG => 'png', IMAGETYPE_WEBP => 'webp'];
    if (!$info || !isset($types[$info[2]])) {
        sendJson(422, ['success' => false, 'message' => 'Unsupported or unreadable image format. Use JPG, PNG, or WebP; HEIC is converted before upload.']);
    }
    if ($info[0] > 6000 || $info[1] > 6000 || $info[0] * $info[1] > 24000000) {
        sendJson(422, ['success' => false, 'message' => 'Image dimensions are too large. Maximum: 6000 pixels per side and 24 million total pixels.']);
    }
    if (!is_dir(UPLOAD_ROOT) && !mkdir(UPLOAD_ROOT, 0755, true)) {
        sendJson(500, ['success' => false, 'message' => 'The server upload directory is unavailable. Contact the administrator.']);
    }
    $compressed = $size > 2 * 1024 * 1024;
    $extension = $compressed ? 'jpg' : $types[$info[2]];
    $name = randomHex(16) . '.' . $extension;
    $target = UPLOAD_ROOT . '/' . $name;
    if (!$compressed) {
        if (!move_uploaded_file((string) $file['tmp_name'], $target)) {
            sendJson(500, ['success' => false, 'message' => 'The server could not save the image. Check upload directory permissions.']);
        }
    } else {
        $raw = @file_get_contents((string) $file['tmp_name']);
        $source = $raw === false ? false : @imagecreatefromstring($raw);
        if (!$source) {
            sendJson(422, ['success' => false, 'message' => 'The image could not be compressed.']);
        }
        $sourceWidth = imagesx($source);
        $sourceHeight = imagesy($source);
        $baseScale = min(1, 3000 / max($sourceWidth, $sourceHeight));
        $saved = false;
        for ($attempt = 0; $attempt < 9; $attempt++) {
            $scale = $baseScale * pow(0.84, max(0, $attempt - 4));
            $width = max(1, (int) round($sourceWidth * $scale));
            $height = max(1, (int) round($sourceHeight * $scale));
            $canvas = imagecreatetruecolor($width, $height);
            $white = imagecolorallocate($canvas, 255, 255, 255);
            imagefill($canvas, 0, 0, $white);
            imagecopyresampled($canvas, $source, 0, 0, 0, 0, $width, $height, $sourceWidth, $sourceHeight);
            $quality = max(42, 82 - ($attempt * 8));
            $written = imagejpeg($canvas, $target, $quality);
            imagedestroy($canvas);
            clearstatcache(true, $target);
            if ($written && is_file($target) && filesize($target) < 1024 * 1024) {
                $saved = true;
                break;
            }
        }
        imagedestroy($source);
        if (!$saved) {
            if (is_file($target)) { unlink($target); }
            sendJson(422, ['success' => false, 'message' => 'The image could not be reduced below 1 MB.']);
        }
    }
    clearstatcache(true, $target);
    return ['path' => 'storage/uploads/questions/' . $name, 'size' => filesize($target), 'compressed' => $compressed];
}

try {
    $pdo = database();
    if ($method === 'POST' && $path === '/admin/login') {
        startSecureSession(); $data=bodyJson(); $identifier=strtolower(textValue($data['email']??'',190));
        $ipHash=hash('sha256',(string)($_SERVER['REMOTE_ADDR']??'unknown'));
        $limit=$pdo->prepare('SELECT COUNT(*) FROM admin_login_attempts WHERE ip_hash=:ip AND attempted_at>DATE_SUB(NOW(),INTERVAL 15 MINUTE)');$limit->execute([':ip'=>$ipHash]);
        if((int)$limit->fetchColumn()>=8){sendJson(429,['success'=>false,'message'=>'Too many sign-in attempts. Try again in 15 minutes.']);}
        if(strpos($identifier,'@')!==false){$stmt=$pdo->prepare('SELECT id,email,password_hash,display_name FROM admin_users WHERE email=:identifier AND is_active=1 LIMIT 2');}
        else{$stmt=$pdo->prepare("SELECT id,email,password_hash,display_name FROM admin_users WHERE LOWER(SUBSTRING_INDEX(email,'@',1))=:identifier AND is_active=1 LIMIT 2");}
        $stmt->execute([':identifier'=>$identifier]);$matches=$stmt->fetchAll();$user=count($matches)===1?$matches[0]:false;
        if(!$user || !password_verify((string)($data['password']??''),$user['password_hash'])){$pdo->prepare('INSERT INTO admin_login_attempts (ip_hash) VALUES (:ip)')->execute([':ip'=>$ipHash]);usleep(350000);sendJson(401,['success'=>false,'message'=>'Invalid email or password.']);}
        $pdo->prepare('DELETE FROM admin_login_attempts WHERE ip_hash=:ip OR attempted_at<DATE_SUB(NOW(),INTERVAL 1 DAY)')->execute([':ip'=>$ipHash]);
        session_regenerate_id(true); $_SESSION['admin_id']=(int)$user['id']; $_SESSION['admin_email']=$user['email']; $_SESSION['admin_name']=$user['display_name']; $_SESSION['csrf']=randomHex(24);
        sendJson(200,['success'=>true,'authenticated'=>true,'admin'=>['email'=>$user['email'],'name'=>$user['display_name']],'csrf'=>$_SESSION['csrf']]);
    }
    if ($path === '/admin/session') {
        if($method==='GET'){startSecureSession();if(empty($_SESSION['admin_id'])){sendJson(200,['success'=>true,'authenticated'=>false]);}sendJson(200,['success'=>true,'authenticated'=>true,'admin'=>['email'=>$_SESSION['admin_email'],'name'=>$_SESSION['admin_name']],'csrf'=>$_SESSION['csrf']]);}
        if($method==='DELETE'){currentAdmin();requireCsrf();$_SESSION=[];session_destroy();sendJson(200,['success'=>true]);}
    }
    if ($method === 'GET' && $path === '/units') {
        $rows=$pdo->query('SELECT id,name,city FROM units WHERE is_active=1 AND active_question_bank_id IS NOT NULL ORDER BY city,name')->fetchAll();
        sendJson(200,['success'=>true,'units'=>$rows]);
    }
    if ($method === 'POST' && $path === '/applications') {
        $data=bodyJson();$name=textValue($data['fullName']??'',150);$birth=textValue($data['birthDate']??'',10);$unit=(int)($data['unitId']??0);
        $date=DateTime::createFromFormat('Y-m-d',$birth);if(strlen($name)<3||!$date||$date->format('Y-m-d')!==$birth||$date>new DateTime('today')){sendJson(422,['success'=>false,'message'=>'Enter a valid name and birth date.']);}
        $stmt=$pdo->prepare('SELECT COUNT(*) FROM units WHERE id=:id AND is_active=1 AND active_question_bank_id IS NOT NULL');$stmt->execute([':id'=>$unit]);if(!(int)$stmt->fetchColumn()){sendJson(422,['success'=>false,'message'=>'Select an available unit.']);}
        do{$reg='AST-'.date('ymd').'-'.strtoupper(substr(randomHex(6),0,12));$check=$pdo->prepare('SELECT COUNT(*) FROM student_applications WHERE registration_number=:r');$check->execute([':r'=>$reg]);}while((int)$check->fetchColumn());
        $stmt=$pdo->prepare('INSERT INTO student_applications (registration_number,full_name,birth_date,unit_id) VALUES (:r,:n,:b,:u)');$stmt->execute([':r'=>$reg,':n'=>$name,':b'=>$birth,':u'=>$unit]);
        sendJson(201,['success'=>true,'application'=>['registrationNumber'=>$reg,'fullName'=>$name]]);
    }
    if ($method === 'POST' && $path === '/exam-preview') {
        $access = examAccessContext($pdo, bodyJson());
        rememberExamPreviewGrant($access);
        $bank = $access['bank'];
        sendJson(200, ['success' => true, 'preview' => [
            'title' => $bank['title'],
            'unitName' => $bank['unitName'],
            'durationSeconds' => $bank['durationSeconds'],
            'questionCount' => count($bank['questions']),
        ]]);
    }
    if ($method === 'POST' && $path === '/exam-attempts') {
        $access = examAccessContext($pdo, bodyJson(), true);
        $tokenId = $access['tokenId'];
        $app = $access['application'];
        $bank = $access['bank'];
        $existing=$pdo->prepare('SELECT public_id FROM exam_attempts WHERE application_id=:id');$existing->execute([':id'=>$app['id']]);$existingId=$existing->fetchColumn();if($existingId){$row=findAttempt($pdo,(string)$existingId);sendJson(200,['success'=>true,'attempt'=>publicAttempt($row)]);}
        $items=[];
        foreach($bank['questions'] as $q){$opts=[];foreach($q['options'] as $key=>$content){$id=randomHex(16);$opts[]=['id'=>$id,'content'=>$content,'imagePaths'=>$q['optionImagePaths'][$key]??[],'correct'=>$key===$q['correctOption']];}if($bank['shuffleOptions']){shuffle($opts);}$correctId='';foreach($opts as $o){if($o['correct']){$correctId=$o['id'];}}$items[]=['id'=>randomHex(16),'content'=>$q['content'],'imagePath'=>$q['imagePath'],'imagePaths'=>$q['imagePaths'],'options'=>$opts,'correctId'=>$correctId];}if($bank['shuffleQuestions']){shuffle($items);}
        $snapshot=['title'=>$bank['title'],'passingScore'=>$bank['passingScore'],'questions'=>$items];$public=randomHex();$stmt=$pdo->prepare("INSERT INTO exam_attempts (public_id,application_id,question_bank_id,exam_token_id,snapshot_json,answers_json,flagged_json,started_at,expires_at,passing_score,total_questions) VALUES (:public,:app,:bank,:token,:snapshot,'{}','[]',NOW(),DATE_ADD(NOW(),INTERVAL :duration SECOND),:passing,:total)");$stmt->execute([':public'=>$public,':app'=>$app['id'],':bank'=>$bank['id'],':token'=>$tokenId,':snapshot'=>json_encode($snapshot),':duration'=>$bank['durationSeconds'],':passing'=>$bank['passingScore'],':total'=>count($items)]);
        $row=findAttempt($pdo,$public);sendJson(201,['success'=>true,'attempt'=>publicAttempt($row)]);
    }
    if (preg_match('#^/exam-attempts/([a-f0-9]{64})(/(?:save|submit))?$#', $path, $match)) {
        $id = $match[1];
        $action = $match[2] ?? '';
        if ($method === 'GET' && $action === '') {
            $row = findAttempt($pdo, $id);
            if ($row['status'] === 'in_progress' && strtotime($row['expires_at']) <= time()) {
                finalizeAttempt($pdo, $row, json_decode((string) ($row['answers_json'] ?: '{}'), true) ?: []);
                $row = findAttempt($pdo, $id);
            }
            sendJson(200, ['success'=>true, 'attempt'=>publicAttempt($row)]);
        }
        if (($method === 'PATCH' && $action === '') || ($method === 'POST' && $action === '/save')) {
            $data = bodyJson();
            $pdo->beginTransaction();
            $row = findAttempt($pdo, $id, true);
            if ($row['status'] !== 'in_progress' || strtotime($row['expires_at']) <= time()) {
                $pdo->rollBack();
                sendJson(409, ['success'=>false, 'message'=>'This exam is no longer accepting answers.']);
            }
            try {
                $answers = validatedAttemptAnswers($row, $data);
            } catch (InvalidArgumentException $error) {
                $pdo->rollBack();
                sendJson(409, ['success'=>false, 'message'=>$error->getMessage()]);
            }
            $flagged = cleanAttemptFlags($row, is_array($data['flagged'] ?? null) ? $data['flagged'] : []);
            $stmt = $pdo->prepare('UPDATE exam_attempts SET answers_json=:a,flagged_json=:f WHERE id=:id');
            $stmt->execute([':a'=>json_encode($answers), ':f'=>json_encode($flagged), ':id'=>$row['id']]);
            $pdo->commit();
            sendJson(200, ['success'=>true, 'savedAt'=>date('c'), 'answerCount'=>(int)$data['answerCount']]);
        }
        if ($method === 'POST' && $action === '/submit') {
            $data = bodyJson();
            $pdo->beginTransaction();
            $row = findAttempt($pdo, $id, true);
            if ($row['status'] === 'submitted') {
                $pdo->rollBack();
                sendJson(200, ['success'=>true, 'result'=>['score'=>(int)$row['score'], 'correctCount'=>(int)$row['correct_count'], 'wrongCount'=>(int)$row['wrong_count'], 'totalQuestions'=>(int)$row['total_questions']]]);
            }
            try {
                $answers = validatedAttemptAnswers($row, $data);
            } catch (InvalidArgumentException $error) {
                $pdo->rollBack();
                sendJson(409, ['success'=>false, 'message'=>$error->getMessage()]);
            }
            $result = finalizeAttempt($pdo, $row, $answers);
            $pdo->commit();
            sendJson(200, ['success'=>true, 'result'=>$result]);
        }
    }

    if (strpos($path, '/admin/') === 0) { $admin=currentAdmin(); if($method!=='GET'){requireCsrf();} }
    if ($method==='GET' && $path==='/admin/units') {$rows=$pdo->query('SELECT u.id,u.name,u.city,u.description,u.is_active AS isActive,u.active_question_bank_id AS activeQuestionBankId,COUNT(qb.id) AS questionBankCount FROM units u LEFT JOIN question_banks qb ON qb.unit_id=u.id GROUP BY u.id ORDER BY u.city,u.name')->fetchAll();sendJson(200,['success'=>true,'units'=>$rows]);}
    if ($method==='POST' && $path==='/admin/units') {$data=bodyJson();$name=textValue($data['name']??'',120);$city=textValue($data['city']??'',20);if($name===''||!in_array($city,['Jakarta','Surabaya'],true)){sendJson(422,['success'=>false,'message'=>'Unit name and city are required.']);}$stmt=$pdo->prepare('INSERT INTO units (name,city,description,is_active) VALUES (:n,:c,:d,:a)');$stmt->execute([':n'=>$name,':c'=>$city,':d'=>textValue($data['description']??'',2000),':a'=>!empty($data['isActive'])?1:0]);sendJson(201,['success'=>true,'id'=>(int)$pdo->lastInsertId()]);}
    if (preg_match('#^/admin/units/(\d+)$#',$path,$m)) {$id=(int)$m[1];if($method==='PATCH'){$data=bodyJson();$name=textValue($data['name']??'',120);$city=textValue($data['city']??'',20);if($name===''||!in_array($city,['Jakarta','Surabaya'],true)){sendJson(422,['success'=>false,'message'=>'Unit name and city are required.']);}$stmt=$pdo->prepare('UPDATE units SET name=:n,city=:c,description=:d,is_active=:a WHERE id=:id');$stmt->execute([':n'=>$name,':c'=>$city,':d'=>textValue($data['description']??'',2000),':a'=>!empty($data['isActive'])?1:0,':id'=>$id]);sendJson(200,['success'=>true]);}if($method==='DELETE'){$stmt=$pdo->prepare('DELETE FROM units WHERE id=:id');$stmt->execute([':id'=>$id]);sendJson(200,['success'=>true]);}}
    if ($method==='GET' && $path==='/admin/question-banks') {$rows=$pdo->query('SELECT qb.id,qb.unit_id AS unitId,qb.title,qb.passing_score AS passingScore,qb.duration_seconds AS durationSeconds,qb.shuffle_questions AS shuffleQuestions,qb.shuffle_options AS shuffleOptions,u.name AS unitName,u.city,(u.active_question_bank_id=qb.id) AS isActive,(SELECT COUNT(*) FROM questions q WHERE q.question_bank_id=qb.id) AS questionCount FROM question_banks qb JOIN units u ON u.id=qb.unit_id ORDER BY qb.id DESC')->fetchAll();sendJson(200,['success'=>true,'questionBanks'=>$rows]);}
    if ($method==='POST' && $path==='/admin/question-banks') {$id=saveBank($pdo,bodyJson());sendJson(201,['success'=>true,'id'=>$id]);}
    if (preg_match('#^/admin/question-banks/(\d+)(/(?:activate|inactivate))?$#', $path, $m)) {
        $id = (int) $m[1];
        $action = $m[2] ?? '';
        if ($method === 'GET' && $action === '') { sendJson(200, ['success'=>true, 'questionBank'=>loadBank($pdo, $id, true)]); }
        if ($method === 'PATCH' && $action === '') { $saved=saveBank($pdo, bodyJson(), $id); sendJson(200, ['success'=>true, 'id'=>$saved]); }
        if ($method === 'POST' && $action === '/activate') {
            $pdo->beginTransaction();
            $stmt=$pdo->prepare('SELECT unit_id FROM question_banks WHERE id=:id FOR UPDATE');
            $stmt->execute([':id'=>$id]);
            $unit=(int)$stmt->fetchColumn();
            if(!$unit){$pdo->rollBack();sendJson(404,['success'=>false,'message'=>'Question bank not found.']);}
            $pdo->prepare('UPDATE units SET active_question_bank_id=:bank WHERE id=:unit')->execute([':bank'=>$id,':unit'=>$unit]);
            $pdo->commit();
            sendJson(200,['success'=>true]);
        }
        if ($method === 'POST' && $action === '/inactivate') {
            $stmt = $pdo->prepare('UPDATE units u JOIN question_banks qb ON qb.unit_id=u.id SET u.active_question_bank_id=NULL WHERE qb.id=:bank AND u.active_question_bank_id=qb.id');
            $stmt->execute([':bank'=>$id]);
            if (!$stmt->rowCount()) {
                $exists = $pdo->prepare('SELECT COUNT(*) FROM question_banks WHERE id=:id');
                $exists->execute([':id'=>$id]);
                if (!(int) $exists->fetchColumn()) { sendJson(404, ['success'=>false, 'message'=>'Question bank not found.']); }
            }
            sendJson(200, ['success'=>true]);
        }
        if ($method === 'DELETE' && $action === '') {
            $stmt=$pdo->prepare('DELETE FROM question_banks WHERE id=:id AND NOT EXISTS (SELECT 1 FROM units WHERE active_question_bank_id=:active)');
            $stmt->execute([':id'=>$id,':active'=>$id]);
            if(!$stmt->rowCount()){sendJson(409,['success'=>false,'message'=>'An active or previously used question bank cannot be deleted.']);}
            sendJson(200,['success'=>true]);
        }
    }
    if ($method==='POST' && $path==='/admin/exam-tokens') {$data=bodyJson();$value=(int)($data['durationValue']??0);$unit=$data['durationUnit']??'seconds';if(!in_array($unit,['seconds','minutes'],true)){sendJson(422,['success'=>false,'message'=>'Choose a valid token duration unit.']);}$seconds=$unit==='seconds'?$value:$value*60;if($seconds<10||$seconds>86400){sendJson(422,['success'=>false,'message'=>'Token duration must be between 10 seconds and 24 hours.']);}do{$token=str_pad((string)random_int(0,9999),4,'0',STR_PAD_LEFT);$check=$pdo->prepare('SELECT COUNT(*) FROM exam_tokens WHERE token_hash=:h AND is_active=1 AND expires_at>NOW()');$check->execute([':h'=>hash('sha256',$token)]);}while((int)$check->fetchColumn());$pdo->beginTransaction();$pdo->exec('UPDATE exam_tokens SET is_active=0 WHERE is_active=1');$stmt=$pdo->prepare('INSERT INTO exam_tokens (token_hash,token_last_four,expires_at,created_by) VALUES (:h,:last,DATE_ADD(NOW(),INTERVAL :seconds SECOND),:admin)');$stmt->execute([':h'=>hash('sha256',$token),':last'=>$token,':seconds'=>$seconds,':admin'=>$admin['id']]);$id=(int)$pdo->lastInsertId();$stmt=$pdo->prepare('SELECT expires_at FROM exam_tokens WHERE id=:id');$stmt->execute([':id'=>$id]);$expires=$stmt->fetchColumn();$pdo->commit();sendJson(201,['success'=>true,'serverNow'=>date('c'),'token'=>['value'=>$token,'expiresAt'=>date('c',strtotime((string)$expires))]]);}
    if ($method==='GET' && $path==='/admin/exam-tokens/current') {$row=$pdo->query('SELECT token_last_four AS value,expires_at AS expiresAt FROM exam_tokens WHERE is_active=1 AND expires_at>NOW() ORDER BY id DESC LIMIT 1')->fetch();if($row){$row['expiresAt']=date('c',strtotime((string)$row['expiresAt']));}sendJson(200,['success'=>true,'serverNow'=>date('c'),'token'=>$row?:null]);}
    if ($method === 'POST' && $path === '/admin/uploads') {
        if (empty($_FILES['image'])) {
            sendJson(422, ['success' => false, 'message' => 'No image was received. The file may exceed the hosting upload limit.']);
        }
        $stored = storeQuestionUpload($_FILES['image']);
        sendJson(201, array_merge(['success' => true], $stored));
    }
    if ($method === 'GET' && $path === '/admin/results/export') {
        $unit = max(0, (int) ($_GET['unitId'] ?? 0));
        $resultStatus = (string) ($_GET['resultStatus'] ?? 'all');
        if (!in_array($resultStatus, ['all', 'passed', 'failed'], true)) {
            sendJson(422, ['success' => false, 'message' => 'Choose a valid result status.']);
        }
        $where = "ea.status='submitted'";
        $params = [];
        if ($unit) {
            $where .= ' AND sa.unit_id=:unit';
            $params[':unit'] = $unit;
        }
        if ($resultStatus === 'passed') {
            $where .= ' AND ea.score>=ea.passing_score';
        } elseif ($resultStatus === 'failed') {
            $where .= ' AND ea.score<ea.passing_score';
        }
        $sql = "SELECT sa.registration_number AS registrationNumber,sa.full_name AS fullName,sa.birth_date AS birthDate,u.name AS unitName,u.city,ea.score,ea.passing_score AS passingScore,CASE WHEN ea.score>=ea.passing_score THEN 'Passed' ELSE 'Failed' END AS resultStatus,ea.correct_count AS correctCount,ea.wrong_count AS wrongCount,ea.total_questions AS totalQuestions,ea.submitted_at AS submittedAt FROM exam_attempts ea JOIN student_applications sa ON sa.id=ea.application_id JOIN units u ON u.id=sa.unit_id WHERE $where ORDER BY ea.submitted_at DESC LIMIT 50001";
        $stmt = $pdo->prepare($sql);
        $stmt->execute($params);
        $rows = $stmt->fetchAll();
        if (count($rows) > 50000) {
            sendJson(413, ['success' => false, 'message' => 'The export exceeds 50,000 results. Narrow the unit or status filter.']);
        }
        sendJson(200, ['success' => true, 'results' => $rows]);
    }
    if ($method === 'GET' && $path === '/admin/results') {
        $page = max(1, (int) ($_GET['page'] ?? 1));
        $requestedSize = (int) ($_GET['pageSize'] ?? 5);
        $size = in_array($requestedSize, [5, 10, 25, 50, 100], true) ? $requestedSize : 5;
        $unit = max(0, (int) ($_GET['unitId'] ?? 0));
        $resultStatus = (string) ($_GET['resultStatus'] ?? 'all');
        $search = textValue($_GET['search'] ?? '', 100);
        if (!in_array($resultStatus, ['all', 'passed', 'failed'], true)) {
            sendJson(422, ['success' => false, 'message' => 'Choose a valid result status.']);
        }
        $where = "ea.status='submitted'";
        $params = [];
        if ($unit) {
            $where .= ' AND sa.unit_id=:unit';
            $params[':unit'] = $unit;
        }
        if ($search !== '') {
            $where .= ' AND (sa.registration_number LIKE :searchRegistration OR sa.full_name LIKE :searchName)';
            $params[':searchRegistration'] = '%' . $search . '%';
            $params[':searchName'] = '%' . $search . '%';
        }
        if ($resultStatus === 'passed') {
            $where .= ' AND ea.score>=ea.passing_score';
        } elseif ($resultStatus === 'failed') {
            $where .= ' AND ea.score<ea.passing_score';
        }
        $count = $pdo->prepare("SELECT COUNT(*) FROM exam_attempts ea JOIN student_applications sa ON sa.id=ea.application_id WHERE $where");
        $count->execute($params);
        $total = (int) $count->fetchColumn();
        $totalPages = max(1, (int) ceil($total / $size));
        $page = min($page, $totalPages);
        $sql = "SELECT ea.public_id AS id,sa.registration_number AS registrationNumber,sa.full_name AS fullName,sa.birth_date AS birthDate,u.id AS unitId,u.name AS unitName,u.city,qb.title AS examTitle,ea.score,ea.passing_score AS passingScore,CASE WHEN ea.score>=ea.passing_score THEN 'Passed' ELSE 'Failed' END AS resultStatus,ea.correct_count AS correctCount,ea.wrong_count AS wrongCount,ea.total_questions AS totalQuestions,ea.submitted_at AS submittedAt FROM exam_attempts ea JOIN student_applications sa ON sa.id=ea.application_id JOIN units u ON u.id=sa.unit_id JOIN question_banks qb ON qb.id=ea.question_bank_id WHERE $where ORDER BY ea.submitted_at DESC LIMIT :limit OFFSET :offset";
        $stmt = $pdo->prepare($sql);
        foreach ($params as $key => $value) {
            $stmt->bindValue($key, $value, $key === ':unit' ? PDO::PARAM_INT : PDO::PARAM_STR);
        }
        $stmt->bindValue(':limit', $size, PDO::PARAM_INT);
        $stmt->bindValue(':offset', ($page - 1) * $size, PDO::PARAM_INT);
        $stmt->execute();
        sendJson(200, ['success' => true, 'results' => $stmt->fetchAll(), 'pagination' => ['page' => $page, 'pageSize' => $size, 'total' => $total, 'totalPages' => $totalPages]]);
    }
    if (preg_match('#^/admin/results/([a-f0-9]{64})$#',$path,$m)) {if($method==='GET'){$row=findAttempt($pdo,$m[1]);$snapshot=json_decode((string)$row['snapshot_json'],true);$answers=json_decode((string)($row['answers_json']?:'{}'),true)?:[];$detail=[];foreach($snapshot['questions'] as $number=>$question){$choices=[];$selected=$answers[$question['id']]??'';foreach($question['options'] as $i=>$option){$choices[]=['label'=>chr(65+$i),'content'=>$option['content'],'imagePaths'=>$option['imagePaths']??[],'selected'=>$selected===$option['id'],'correct'=>$question['correctId']===$option['id']];}$imagePaths=$question['imagePaths']??(!empty($question['imagePath'])?[$question['imagePath']]:[]);$detail[]=['number'=>$number+1,'content'=>$question['content'],'imagePath'=>$imagePaths[0]??null,'imagePaths'=>$imagePaths,'options'=>$choices];}$passingScore=(int)$row['passing_score'];$score=(int)$row['score'];sendJson(200,['success'=>true,'result'=>['registrationNumber'=>$row['registration_number'],'fullName'=>$row['full_name'],'unitName'=>$row['unit_name'],'examTitle'=>$snapshot['title']??'Admission Test','score'=>$score,'passingScore'=>$passingScore,'resultStatus'=>$score>=$passingScore?'Passed':'Failed','correctCount'=>(int)$row['correct_count'],'wrongCount'=>(int)$row['wrong_count'],'totalQuestions'=>(int)$row['total_questions'],'submittedAt'=>$row['submitted_at'],'questions'=>$detail]]);}if($method==='DELETE'){$stmt=$pdo->prepare('DELETE FROM exam_attempts WHERE public_id=:id');$stmt->execute([':id'=>$m[1]]);sendJson(200,['success'=>true]);}}
    sendJson(404,['success'=>false,'message'=>'Endpoint not found.']);
} catch (PDOException $error) {
    error_log($error->getMessage());
    $duplicate=(int)($error->errorInfo[1]??0)===1062;
    sendJson($duplicate?409:500,['success'=>false,'message'=>$duplicate?'That value already exists.':'Database request failed.']);
} catch (Throwable $error) {
    error_log($error->getMessage());
    sendJson(500,['success'=>false,'message'=>'Server request failed.']);
}
