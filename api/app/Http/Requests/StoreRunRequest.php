<?php

namespace App\Http\Requests;

use Closure;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Validator;

class StoreRunRequest extends FormRequest
{
    public function authorize(): bool
    {
        return $this->user() !== null;
    }

    public function rules(): array
    {
        $finite = function (string $attribute, mixed $value, Closure $fail) {
            if ((!is_int($value) && !is_float($value)) || !is_finite((float) $value)) {
                $fail("The {$attribute} must be a finite JSON number.");
            }
        };
        $boolean = ['required', function (string $attribute, mixed $value, Closure $fail) {
            if (!is_bool($value)) {
                $fail("The {$attribute} must be a JSON boolean.");
            }
        }];
        $number = fn (float $min, float $max) => ['required', 'numeric', "between:{$min},{$max}", $finite];
        $optional = fn (float $min, float $max) => ['sometimes', 'numeric', "between:{$min},{$max}", $finite];
        $nullable = fn (float $min, float $max) => ['present', 'nullable', 'numeric', "between:{$min},{$max}", $finite];
        $id = ['required', 'string', 'max:128', 'regex:/^[A-Za-z0-9_.:-]+$/'];
        $rules = [
            'client_run_id' => 'required|uuid',
            'scenario' => 'required|in:recovering,worsening,sensor_fault',
            'seed' => ['required', 'integer', 'between:0,4294967295', $finite],
            'config' => 'required|array:scenario,seed,durationS,continuousFlow,utilization,controller',
            'config.scenario' => 'required|same:scenario',
            'config.seed' => ['required', 'integer', 'same:seed', $finite],
            'config.durationS' => $number(0, 86400),
            'config.continuousFlow' => $number(0, 30),
            'config.utilization' => $number(0, 1),
            'config.controller' => 'required|array:prescribedMaxFlow,initialFlow,spo2Target,minimumFlow,targetLow,targetHigh,inhaleThreshold,maxOpenTimeS,inhaleDebounceTicks,warmupS,noBreathS,sensorWarningS,sensorCriticalS,criticalThreshold,criticalDurationS,recoveryS,averageWindowS,minimumCoverage,adjustmentIntervalS,maxSensorAgeS,fallbackFlow',
            'config.controller.prescribedMaxFlow' => $number(0, 30),
            'config.controller.initialFlow' => $number(0, 30),
            'config.controller.spo2Target' => 'required|in:standard,co2retain',
            'config.controller.minimumFlow' => $optional(0, 30),
            'config.controller.fallbackFlow' => $optional(0, 30),
            'config.controller.targetLow' => $optional(0, 100),
            'config.controller.targetHigh' => $optional(0, 100),
            'config.controller.criticalThreshold' => $optional(0, 100),
            'config.controller.inhaleThreshold' => $optional(0.01, 20),
            'config.controller.inhaleDebounceTicks' => ['sometimes', 'integer', 'between:1,100', $finite],
            'config.controller.minimumCoverage' => $optional(0.01, 1),
            'summary' => 'required|array:armA,armB,oxygenSavedPct,simDurationS',
            'summary.simDurationS' => $number(0, 86400),
            'summary.oxygenSavedPct' => ['present', 'nullable', 'numeric', 'max:100', $finite],
            'event_log' => 'present|array|max:10100',
            'event_log.*' => 'array:id,timeS,code,message',
            'event_log.*.id' => [...$id, 'distinct:strict'],
            'event_log.*.timeS' => $number(0, 86400),
            'event_log.*.code' => 'required|string|max:80',
            'event_log.*.message' => 'required|string|max:1000',
            'faults' => 'present|array|max:100',
            'faults.*' => 'array:id,kind,startS,endS',
            'faults.*.id' => [...$id, 'distinct:strict'],
            'faults.*.kind' => 'required|in:spo2_loss,pressure_loss,motion',
            'faults.*.startS' => $number(0, 86400),
            'faults.*.endS' => $number(0, 86400),
            'series' => 'present|array|max:5000',
            'series.*' => 'array:timeS,spo2A,spo2B,flowA,flowB,actualFlowA,actualFlowB,pressureB,valveB,isInhaling',
            'series.*.timeS' => $number(0, 86400),
            'series.*.spo2A' => $nullable(0, 100),
            'series.*.spo2B' => $nullable(0, 100),
            'series.*.pressureB' => $nullable(-20, 20),
            'series.*.valveB' => $boolean,
            'series.*.isInhaling' => $boolean,
            'alarms' => 'present|array|max:10000',
            'alarms.*' => 'array:id,code,level,message,onsetS,active,acknowledged,resolvedS,activeDurationS',
            'alarms.*.id' => [...$id, 'distinct:strict'],
            'alarms.*.code' => 'required|string|max:80',
            'alarms.*.level' => 'required|in:CRITICAL,WARNING,INFO',
            'alarms.*.message' => 'required|string|max:1000',
            'alarms.*.onsetS' => $number(0, 86400),
            'alarms.*.activeDurationS' => $number(0, 86400),
            'alarms.*.resolvedS' => $nullable(0, 86400),
            'alarms.*.active' => $boolean,
            'alarms.*.acknowledged' => $boolean,
            'provenance' => 'required|array:schemaVersion,modelVersion,controllerVersion,source,verification,stepS,droppedEvents,droppedAlarms',
            'provenance.schemaVersion' => 'required|string|in:2',
            'provenance.modelVersion' => 'required|string|in:dose-integral-1',
            'provenance.controllerVersion' => 'required|string|in:state-machine-1',
            'provenance.source' => 'required|string|in:synthetic',
            'provenance.verification' => 'required|string|in:client-submitted',
            'provenance.stepS' => ['required', 'numeric', 'in:0.1', $finite],
            'provenance.droppedEvents' => ['required', 'integer', 'between:0,10000000', $finite],
            'provenance.droppedAlarms' => ['required', 'integer', 'between:0,10000000', $finite],
        ];
        foreach (['maxOpenTimeS', 'noBreathS', 'sensorWarningS', 'sensorCriticalS', 'criticalDurationS', 'recoveryS', 'averageWindowS', 'adjustmentIntervalS', 'maxSensorAgeS'] as $field) {
            $rules["config.controller.{$field}"] = $optional(0.1, 3600);
        }
        $rules['config.controller.warmupS'] = $optional(0.1, 3600);
        $metrics = 'totalOxygenL,belowRangeS,inRangeS,aboveRangeS,belowCriticalS,missingS,invalidS,staleS,lowQualityS,validS,validCoveragePct,alarmEpisodes,alarmActiveS';
        foreach (['armA', 'armB'] as $arm) {
            $rules["summary.{$arm}"] = 'required|array:'.$metrics;
            foreach (explode(',', $metrics) as $field) {
                $rules["summary.{$arm}.{$field}"] = match ($field) {
                    'validCoveragePct' => $nullable(0, 100),
                    'alarmEpisodes' => ['required', 'integer', 'between:0,10000000', $finite],
                    'totalOxygenL' => $number(0, 43200.0001),
                    default => $number(0, 86400.0001),
                };
            }
        }
        foreach (['flowA', 'flowB', 'actualFlowA', 'actualFlowB'] as $field) {
            $rules["series.*.{$field}"] = $number(0, 30);
        }
        return $rules;
    }

    public function withValidator(Validator $validator): void
    {
        $validator->after(function (Validator $validator) {
            if ($validator->errors()->isNotEmpty()) {
                return;
            }
            $data = $this->all();
            $known = ['client_run_id', 'scenario', 'seed', 'config', 'summary', 'event_log', 'series', 'faults', 'alarms', 'provenance'];
            if (array_diff(array_keys($data), $known)) {
                $validator->errors()->add('payload', 'Unknown top-level fields are not accepted.');
            }
            $close = fn ($a, $b) => abs($a - $b) <= max(0.0001, abs($b) * 1.0e-8);
            $error = fn ($field, $message) => $validator->errors()->add($field, $message);
            $duration = $data['summary']['simDurationS'];
            if (!$close($duration, $data['config']['durationS'])) {
                $error('summary.simDurationS', 'Only completed runs with their actual configured duration can be saved.');
            }
            $c = $data['config']['controller'];
            $min = $c['minimumFlow'] ?? 0;
            $max = $c['prescribedMaxFlow'];
            if ($min > $c['initialFlow'] || $c['initialFlow'] > $max || ($c['fallbackFlow'] ?? $max) < $min || ($c['fallbackFlow'] ?? $max) > $max) {
                $error('config.controller', 'Require minimum <= initial <= maximum, with fallback inside the same bounds.');
            }
            $lo = $c['targetLow'] ?? ($c['spo2Target'] === 'standard' ? 92 : 88);
            $hi = $c['targetHigh'] ?? ($c['spo2Target'] === 'standard' ? 96 : 92);
            if ($lo >= $hi || ($c['criticalThreshold'] ?? 88) > $lo || ($c['sensorWarningS'] ?? 2) > ($c['sensorCriticalS'] ?? 120)
                || abs(($c['maxOpenTimeS'] ?? .8) * 10 - round(($c['maxOpenTimeS'] ?? .8) * 10)) > 1.0e-8) {
                $error('config.controller', 'Target, critical threshold, or sensor delay ordering is invalid.');
            }
            foreach (['armA', 'armB'] as $arm) {
                $s = $data['summary'][$arm];
                if (!$close($s['validS'] + $s['missingS'] + $s['invalidS'] + $s['staleS'] + $s['lowQualityS'], $duration)
                    || !$close($s['belowRangeS'] + $s['inRangeS'] + $s['aboveRangeS'], $s['validS'])
                    || $s['belowCriticalS'] > $s['belowRangeS'] + .0001 || $s['alarmActiveS'] > $duration + .0001) {
                    $error("summary.{$arm}", 'Duration and coverage categories must reconcile.');
                }
                if (($duration === 0 || $duration === 0.0) ? $s['validCoveragePct'] !== null : ($s['validCoveragePct'] === null || !$close($s['validCoveragePct'], 100 * $s['validS'] / $duration))) {
                    $error("summary.{$arm}.validCoveragePct", 'Coverage must reconcile with actual duration; zero duration has no percentage.');
                }
            }
            $a = $data['summary']['armA']['totalOxygenL'];
            $b = $data['summary']['armB']['totalOxygenL'];
            $pct = $data['summary']['oxygenSavedPct'];
            $expectedPct = $a > 0 ? ($a - $b) / $a * 100 : null;
            if ($expectedPct !== null && !is_finite($expectedPct)) {
                $expectedPct = null;
            }
            if (!$close($a, $data['config']['continuousFlow'] * $duration / 60)
                || $b > $max * $duration / 60 + .0001
                || ($expectedPct === null ? $pct !== null : ($pct === null || !$close($pct, $expectedPct)))) {
                $error('summary', 'Gas arithmetic does not reconcile with the submitted configuration.');
            }
            if ($duration > 0 && (!$data['series'] || $data['series'][0]['timeS'] != 0
                || !$close($data['series'][array_key_last($data['series'])]['timeS'], $duration))) {
                $error('series', 'Chart samples must retain both recording boundaries.');
            }
            if ($duration == 0 && $data['series']) {
                $error('series', 'A zero-duration run has no chart intervals.');
            }
            foreach ($data['series'] as $point) {
                if (!$close($point['flowA'], $data['config']['continuousFlow'])
                    || !$close($point['actualFlowA'], $point['flowA'])
                    || $point['flowB'] > $max
                    || !$close($point['actualFlowB'], $point['valveB'] ? $point['flowB'] : 0)) {
                    $error('series', 'Sampled requested and actual flows are inconsistent.');
                    break;
                }
            }
            foreach (['event_log', 'series'] as $collection) {
                $previous = -1;
                foreach ($data[$collection] as $item) {
                    if ($item['timeS'] < $previous || $item['timeS'] > $duration + .0001) {
                        $error($collection, 'Times must be ordered and inside the run.');
                        break;
                    }
                    $previous = $item['timeS'];
                }
            }
            foreach ($data['faults'] as $fault) {
                if ($fault['startS'] >= $fault['endS'] || $fault['endS'] > $duration + .0001) {
                    $error('faults', 'Fault windows must be ordered and inside the run.');
                }
            }
            foreach ($data['alarms'] as $alarm) {
                $end = $alarm['resolvedS'] ?? $duration;
                if ($end < $alarm['onsetS'] || $end > $duration + .0001 || $alarm['active'] !== ($alarm['resolvedS'] === null)
                    || $alarm['activeDurationS'] > $end - $alarm['onsetS'] + .1001) {
                    $error('alarms', 'Alarm lifecycle times are inconsistent.');
                }
            }
            if ($data['summary']['armB']['alarmEpisodes'] !== count($data['alarms']) + $data['provenance']['droppedAlarms']
                || $data['summary']['armA']['alarmEpisodes'] != 0 || $data['summary']['armA']['alarmActiveS'] != 0) {
                $error('alarms', 'Alarm episodes must reconcile with retained and omitted controller history.');
            }
        });
    }
}
