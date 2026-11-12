<?php

namespace App\Http\Controllers;

use App\Http\Requests\ReplayAiRequest;
use App\Services\AiService;
use App\Services\ReplayEvidence;
use Illuminate\Http\JsonResponse;

class ReplayAiController extends Controller
{
    public function __invoke(ReplayAiRequest $request, ReplayEvidence $evidence, AiService $ai): JsonResponse
    {
        $input = $request->validated();
        $subject = $input['subject_id'];
        $view = $input['view'];
        $action = $input['action'];
        $start = (float) $input['start_s'];
        $end = (float) $input['end_s'];
        $eventId = $input['event_id'] ?? null;
        $window = $evidence->window($subject, $view, $start, $end);
        if ($end === 0.0) {
            return $this->response(
                'The replay is at 0 seconds. No playback has elapsed in this session, so there are no played events to summarize. Press Play to begin.',
                'template', null, [],
            );
        }
        $summary = $window['summary'];
        $events = $window['events'];
        $selectedEvent = $eventId === null ? null : ($events[$eventId] ?? null);
        abort_if($eventId !== null && $selectedEvent === null, 404, 'Event unavailable in this view and time range.');

        $result = $ai->selectReplayEvidence(json_encode([
            'subject' => $subject,
            'view' => $view,
            'action' => $action,
            'start_s' => $start,
            'end_s' => $end,
            'selected_event_id' => $eventId,
            'question' => $input['question'] ?? null,
            'prior_questions' => $input['history'] ?? [],
            'summary' => $summary,
            'events' => array_values($events),
            'readings' => array_values($window['readings']),
        ], JSON_THROW_ON_ERROR));

        $candidates = $events + $window['readings'] + [$summary['id'] => $summary];
        $selection = $result['source'] === 'ai'
            ? $this->selection($result['text'], $candidates, $action, $eventId)
            : null;
        if ($selection === []) {
            return $this->response('The selected recording window does not show that information.', 'ai', null, []);
        }
        if ($selection === null) {
            $selected = $selectedEvent === null
                ? [$summary, ...array_slice($events, 0, 3)]
                : [$selectedEvent];
            $text = $this->format($selected, $action, $subject, $start, $end);
            if ($action === 'ask') {
                $text = "An AI answer is unavailable. Here is the recorded evidence.\n\n".$text;
            }

            return $this->response($text, 'template', $result['reason'] ?? 'AI returned evidence outside the selected scope.', $selected);
        }
        if ($action === 'handover') {
            $selection = [$summary['id'] => $summary] + $selection;
        }

        return $this->response($this->format($selection, $action, $subject, $start, $end), 'ai', null, $selection);
    }

    private function selection(string $text, array $candidates, string $action, ?string $eventId): ?array
    {
        $selection = json_decode($text, true);
        $ids = $selection['evidence_ids'] ?? null;
        if (! is_array($ids) || ! array_is_list($ids) || count($ids) > 5) {
            return null;
        }
        if (($selection['supported'] ?? null) === false && $action === 'ask' && $ids === []) {
            return [];
        }
        if (($selection['supported'] ?? null) !== true || $ids === []) {
            return null;
        }

        $rows = [];
        foreach ($ids as $id) {
            if (! is_string($id) || ! isset($candidates[$id]) || isset($rows[$id])) {
                return null;
            }
            $rows[$id] = $candidates[$id];
        }
        if ($action === 'explain' && ! isset($rows[$eventId])) {
            return null;
        }

        return $rows;
    }

    private function format(array $rows, string $action, string $subject, float $start, float $end): string
    {
        $lines = [];
        if ($action === 'handover') {
            $lines[] = 'Replay handover draft · BIDMC Subject '.$subject.' · '.ReplayEvidence::number($start).'–'.ReplayEvidence::number($end).' s';
        }
        foreach ($rows as $row) {
            $time = ReplayEvidence::number($row['timeS']).' s';
            if ($row['id'] === 'window-summary') {
                $lines[] = $row['detail'];
            } elseif (array_key_exists('value', $row)) {
                $lines[] = $row['value'] === null
                    ? "There was no recorded SpO₂ reading at {$time}."
                    : 'Recorded SpO₂ was '.ReplayEvidence::number($row['value'])."% at {$time}.";
            } else {
                $lines[] = $row['label'].' at '.$time.'. '.$row['detail'];
            }
        }
        if ($action === 'handover') {
            $lines[] = 'Review the selected readings and timeline before using this draft.';
        }

        return implode("\n\n", $lines);
    }

    private function response(string $text, string $source, ?string $reason, array $evidence): JsonResponse
    {
        return response()->json([
            'text' => $text,
            'source' => $source,
            'reason' => $reason,
            'evidence' => array_values(array_map(fn ($row) => array_intersect_key(
                $row,
                array_flip(['id', 'timeS', 'label', 'detail']),
            ), $evidence)),
        ]);
    }
}
