<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('runs', function (Blueprint $table) {
            $table->id();
            $table->string('scenario', 32);          // recovering | worsening | sensor_fault
            $table->integer('seed')->default(42);
            $table->jsonb('summary');                // ArmStats A + B + oxygenSavedPct etc.
            $table->jsonb('event_log');              // array of {timeS, message}
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('runs');
    }
};
