<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class Run extends Model
{
    protected $fillable = ['user_id', 'client_run_id', 'payload_hash', 'scenario', 'seed', 'summary', 'event_log', 'config', 'series', 'faults', 'alarms', 'provenance', 'legacy'];

    protected $hidden = ['user_id', 'payload_hash'];

    protected $casts = [
        'summary'   => 'array',
        'event_log' => 'array',
        'seed'      => 'integer',
        'config' => 'array',
        'series' => 'array',
        'faults' => 'array',
        'alarms' => 'array',
        'provenance' => 'array',
        'legacy' => 'boolean',
    ];
}
