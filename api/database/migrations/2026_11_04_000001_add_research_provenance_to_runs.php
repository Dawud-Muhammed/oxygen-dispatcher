<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('runs', function (Blueprint $table) {
            $table->foreignId('user_id')->nullable()->constrained()->restrictOnDelete();
            $table->uuid('client_run_id')->nullable();
            $table->string('payload_hash', 64)->nullable();
            $table->boolean('legacy')->default(true);
            foreach (['config', 'series', 'faults', 'alarms', 'provenance'] as $field) {
                $table->json($field)->nullable();
            }
            $table->unique(['user_id', 'client_run_id']);
            $table->bigInteger('seed')->change();
        });
        // Existing records stay intact, marked legacy and unowned.
    }

    public function down(): void
    {
        Schema::table('runs', function (Blueprint $table) {
            $table->dropUnique(['user_id', 'client_run_id']);
            $table->dropForeign(['user_id']);
            $table->dropColumn(['user_id', 'client_run_id', 'payload_hash', 'legacy', 'config', 'series', 'faults', 'alarms', 'provenance']);
        });
    }
};
