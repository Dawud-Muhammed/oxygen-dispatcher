<?php

namespace App\Services;

use JsonException;

class ReplayEvidence
{
    public function window(string $subject, string $view, float $start, float $end): array
    {
        $index = $this->read('index.json');
        $subjects = $index['subjects'] ?? [];
        $entry = collect($subjects)->firstWhere('id', $subject);
        abort_unless($entry, 404, 'Recording unavailable.');
        abort_if($view === 'valve' && !($entry['hasBreaths'] ?? false), 422, 'This recording has no breath annotations.');

        $recording = $this->read("subject_{$subject}.json");
        $bundle = $this->read("subject_{$subject}_evidence.json");
        $duration = $recording['durationS'] ?? null;
        abort_unless(
            ($recording['subjectId'] ?? null) === $subject &&
            ($bundle['subjectId'] ?? null) === $subject &&
            $this->validNumber($duration) &&
            $this->validNumber($bundle['durationS'] ?? null) &&
            (float) ($bundle['durationS'] ?? -1) === (float) $duration &&
            is_array($recording['samples'] ?? null) &&
            is_array($bundle['events'] ?? null),
            503,
            'Recording evidence is unavailable.',
        );
        abort_unless(is_finite($start) && is_finite($end) && $start >= 0 && $start <= $end && $end <= $duration,
            422, 'The selected time range is outside this recording.');

        $events = $this->events($bundle['events'], $view, $start, $end);
        $readings = $this->readings($recording['samples'], $start, $end);
        $summary = $this->summary($readings, $start, $events, $view);

        return [
            'events' => $events,
            'readings' => $readings,
            'summary' => $summary,
        ];
    }

    private function read(string $file): array
    {
        $path = rtrim(config('services.replay.directory'), '/\\').DIRECTORY_SEPARATOR.$file;
        abort_unless(is_file($path) && is_readable($path), 503, 'Recording evidence is unavailable.');

        try {
            $content = file_get_contents($path, length: 2 * 1024 * 1024);
            $data = $content === false ? null : json_decode($content, true, flags: JSON_THROW_ON_ERROR);
        } catch (JsonException) {
            abort(503, 'Recording evidence is unavailable.');
        }
        abort_unless(is_array($data), 503, 'Recording evidence is unavailable.');

        return $data;
    }

    private function events(array $events, string $view, float $start, float $end): array
    {
        $kinds = $view === 'valve'
            ? ['valve-open', 'valve-closed', 'valve-unknown']
            : ['spo2-rise', 'spo2-fall', 'spo2-missing', 'spo2-restored'];
        $scoped = [];
        foreach ($events as $event) {
            if (!in_array($event['kind'] ?? null, $kinds, true)) {
                continue;
            }
            $time = $event['timeS'] ?? null;
            $id = $event['id'] ?? null;
            abort_unless(
                is_string($id) && $id !== '' && !isset($scoped[$id]) &&
                $this->validNumber($time) &&
                is_string($event['label'] ?? null) &&
                is_string($event['detail'] ?? null),
                503,
                'Recording evidence is unavailable.',
            );
            if ($time < $start || $time > $end) {
                continue;
            }
            $scoped[$id] = [
                'id' => $id,
                'timeS' => $time,
                'kind' => $event['kind'],
                'label' => $event['label'],
                'detail' => $event['detail'],
            ];
        }

        return $scoped;
    }

    private function readings(array $samples, float $start, float $end): array
    {
        $scoped = [];
        foreach ($samples as $index => $sample) {
            $time = $sample['timeS'] ?? null;
            abort_unless($this->validNumber($time), 503, 'Recording evidence is unavailable.');
            if ($time < $start || $time > $end) {
                continue;
            }
            $value = $sample['value'] ?? null;
            abort_unless($value === null || ($this->validNumber($value) && $value >= 0 && $value <= 100),
                503, 'Recording evidence is unavailable.');
            $id = 'reading-'.$index;
            $scoped[$id] = [
                'id' => $id,
                'timeS' => $time,
                'label' => 'Recorded SpO₂',
                'detail' => $value === null ? 'Reading unavailable.' : self::number($value).'%.',
                'value' => $value,
            ];
        }

        return $scoped;
    }

    private function summary(array $readings, float $start, array $events, string $view): array
    {
        $values = array_filter(array_column($readings, 'value'), fn ($value) => $value !== null);
        $missing = count($readings) - count($values);
        $details = [];
        if ($values) {
            $min = self::number(min($values));
            $max = self::number(max($values));
            $details[] = $min === $max
                ? "Recorded SpO₂ was {$min}% across ".count($values).' available readings.'
                : "Recorded SpO₂ ranged from {$min}% to {$max}% across ".count($values).' available readings.';
        } else {
            $details[] = 'There were no available SpO₂ readings in this time window.';
        }
        if ($missing) {
            $details[] = "{$missing} ".($missing === 1 ? 'recorded timestamp had' : 'recorded timestamps had').' an unavailable SpO₂ reading.';
        }
        $eventCount = count(array_filter($events, fn ($event) => $event['kind'] !== 'valve-unknown'));
        $eventLabel = $view === 'valve' ? 'virtual valve change' : 'SpO₂ review event';
        $details[] = "{$eventCount} {$eventLabel}".($eventCount === 1 ? '' : 's').' in this time window.';

        return [
            'id' => 'window-summary',
            'timeS' => $start,
            'label' => 'Selected window',
            'detail' => implode(' ', $details),
        ];
    }

    private function validNumber(mixed $number): bool
    {
        return (is_int($number) || is_float($number)) && is_finite($number);
    }

    public static function number(float $number): string
    {
        return rtrim(rtrim(number_format($number, 3, '.', ''), '0'), '.');
    }
}
