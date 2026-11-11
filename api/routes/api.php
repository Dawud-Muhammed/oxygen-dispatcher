<?php

use App\Http\Controllers\AiController;
use App\Http\Controllers\RunController;
use Illuminate\Support\Facades\Route;

Route::middleware(['auth:sanctum', \App\Http\Middleware\ResearchAccess::class, 'throttle:research'])->group(function () {
    Route::post('/runs', [RunController::class, 'store'])->middleware('throttle:research-saves');
    Route::get('/runs', [RunController::class, 'index']);
    Route::get('/runs/{id}', [RunController::class, 'show'])->whereNumber('id');
    Route::middleware('throttle:research-ai')->group(function () {
        Route::post('/ai/handover', [AiController::class, 'handover']);
        Route::post('/ai/ask', [AiController::class, 'ask']);
        Route::post('/ai/explain-event', [AiController::class, 'explainEvent']);
    });
});
