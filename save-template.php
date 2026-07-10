<?php
// Set CORS headers
header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Headers: Content-Type");
header("Access-Control-Allow-Methods: POST, GET, OPTIONS");
header("Content-Type: application/json; charset=UTF-8");

// Handle preflight OPTIONS request
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    exit(0);
}

$dbPath = __DIR__ . '/saved-templates.json';

// Initialize list file if it doesn't exist
if (!file_exists($dbPath)) {
    file_put_contents($dbPath, json_encode([
        [
            "id" => "tpl_default",
            "name" => "Default Factory Design",
            "schema" => null // Fallback to engine defaults
        ]
    ], JSON_PRETTY_PRINT));
}

// Read current template list
$rawList = file_get_contents($dbPath);
$templates = json_decode($rawList, true) ?: [];

// If it's a GET request, just return the templates list
if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    echo json_encode([
        "status" => "success",
        "templates" => $templates
    ]);
    exit;
}

// Read POST payload
$rawInput = file_get_contents('php://input');
$inputData = json_decode($rawInput, true);

if ($inputData) {
    $action = $inputData['action'] ?? 'save';
    
    if ($action === 'delete') {
        $id = $inputData['id'] ?? '';
        $templates = array_values(array_filter($templates, function($t) use ($id) {
            return $t['id'] !== $id;
        }));
        file_put_contents($dbPath, json_encode($templates, JSON_PRETTY_PRINT));
        echo json_encode([
            "status" => "success",
            "message" => "Template deleted successfully",
            "templates" => $templates
        ]);
        exit;
    }
    
    // Save template (add or update)
    $id = $inputData['id'] ?? '';
    $name = $inputData['name'] ?? 'Unnamed Template';
    $category = $inputData['category'] ?? 'Student ID';
    $schema = $inputData['schema'] ?? null;
    
    if ($id && $schema) {
        $found = false;
        foreach ($templates as &$t) {
            if ($t['id'] === $id) {
                $t['name'] = $name;
                $t['category'] = $category;
                $t['schema'] = $schema;
                $found = true;
                break;
            }
        }
        if (!$found) {
            $templates[] = [
                "id" => $id,
                "name" => $name,
                "category" => $category,
                "schema" => $schema
            ];
        }
        
        file_put_contents($dbPath, json_encode($templates, JSON_PRETTY_PRINT));
        echo json_encode([
            "status" => "success",
            "message" => "Template saved successfully",
            "templates" => $templates
        ]);
        exit;
    }
}

// Fallback response
echo json_encode([
    "status" => "success",
    "templates" => $templates
]);
