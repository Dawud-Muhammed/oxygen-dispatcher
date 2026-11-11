<?php

namespace Tests\Feature;

use App\Models\Run;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Http;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class ResearchApiTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        Http::preventStrayRequests();
        config(['services.ai.api_key' => null, 'services.ai.model' => null]);
    }

    private function login(): User
    {
        $user = User::factory()->create();
        Sanctum::actingAs($user, ['research']);
        return $user;
    }

    private function payload(): array
    {
        $arm = ['totalOxygenL' => 5 / 60, 'belowRangeS' => 0, 'inRangeS' => 1, 'aboveRangeS' => 0,
            'belowCriticalS' => 0, 'missingS' => 0, 'invalidS' => 0, 'staleS' => 0, 'lowQualityS' => 0,
            'validS' => 1, 'validCoveragePct' => 100, 'alarmEpisodes' => 0, 'alarmActiveS' => 0];
        return [
            'client_run_id' => 'b8d03b80-83a6-43c5-94c2-67a403e8b885', 'scenario' => 'recovering', 'seed' => 42,
            'config' => ['scenario' => 'recovering', 'seed' => 42, 'durationS' => 1, 'continuousFlow' => 5,
                'utilization' => .75, 'controller' => ['prescribedMaxFlow' => 5, 'initialFlow' => 5, 'spo2Target' => 'standard']],
            'summary' => ['armA' => $arm, 'armB' => $arm, 'oxygenSavedPct' => 0, 'simDurationS' => 1],
            'event_log' => [['id' => 'event-1', 'timeS' => 0, 'code' => 'SENSOR_LOSS', 'message' => 'Early simulated sensor fault.']],
            'series' => array_map(fn ($time) => ['timeS' => $time, 'spo2A' => 95, 'spo2B' => 95,
                'flowA' => 5, 'flowB' => 5, 'actualFlowA' => 5, 'actualFlowB' => 5,
                'pressureB' => .4, 'valveB' => true, 'isInhaling' => false], [0, 1]),
            'faults' => [], 'alarms' => [],
            'provenance' => ['schemaVersion' => '2', 'modelVersion' => 'dose-integral-1', 'controllerVersion' => 'state-machine-1',
                'source' => 'synthetic', 'verification' => 'client-submitted', 'stepS' => .1, 'droppedEvents' => 0, 'droppedAlarms' => 0],
        ];
    }

    public function test_authentication_is_required_for_every_research_endpoint(): void
    {
        $this->getJson('/api/runs')->assertUnauthorized();
        $this->getJson('/api/runs/1')->assertUnauthorized();
        $this->postJson('/api/runs', $this->payload())->assertUnauthorized();
        foreach (['handover', 'ask', 'explain-event'] as $endpoint) {
            $this->postJson('/api/ai/'.$endpoint, ['run_id' => 1])->assertUnauthorized();
        }
    }

    public function test_real_typescript_engine_export_round_trips_without_semantic_loss(): void
    {
        $this->login();
        $payload = json_decode(file_get_contents(__DIR__.'/../Fixtures/engine-run.json'), true, flags: JSON_THROW_ON_ERROR);
        $response = $this->postJson('/api/runs', $payload);
        $response->assertCreated();
        $stored = $this->getJson('/api/runs/'.$response->json('id'))->assertOk();
        $this->assertEquals($payload['config'], $stored->json('config'));
        $this->assertEquals($payload['alarms'], $stored->json('alarms'));
        $this->assertEquals($payload['summary'], $stored->json('summary'));
        $this->assertEquals($payload['series'], $stored->json('series'));
    }

    public function test_tokens_need_research_ability(): void
    {
        $token = User::factory()->create()->createToken('test', ['unrelated'])->plainTextToken;
        $this->withToken($token)->getJson('/api/runs')->assertForbidden();
    }

    public function test_real_personal_token_authenticates_the_owner_without_session_login(): void
    {
        $user = User::factory()->create();
        $token = $user->createToken('test', ['research'], now()->addDay())->plainTextToken;
        $id = $this->withToken($token)->postJson('/api/runs', $this->payload())
            ->assertCreated()->json('id');
        $this->assertDatabaseHas('runs', ['id' => $id, 'user_id' => $user->id]);
        $this->withToken($token)->getJson('/api/runs/'.$id)->assertOk();
    }

    public function test_owner_scoping_prevents_cross_account_reading_and_ai_access(): void
    {
        $this->login();
        $id = $this->postJson('/api/runs', $this->payload())->assertCreated()->json('id');
        $this->login();
        $this->getJson('/api/runs')->assertExactJson([]);
        $this->getJson('/api/runs/'.$id)->assertNotFound();
        $this->postJson('/api/ai/handover', ['run_id' => $id])->assertNotFound();
    }

    public function test_save_retry_is_idempotent_and_conflicting_retry_is_rejected(): void
    {
        $this->login();
        $payload = $this->payload();
        $id = $this->postJson('/api/runs', $payload)->assertCreated()->assertJsonPath('legacy', false)->json('id');
        $this->postJson('/api/runs', $payload)->assertOk()->assertJsonPath('id', $id);
        $payload['event_log'][0]['message'] = 'Different event';
        $this->postJson('/api/runs', $payload)->assertConflict();
        $this->assertDatabaseCount('runs', 1);
        $this->getJson('/api/runs/'.$id)->assertOk()->assertJsonPath('provenance.verification', 'client-submitted')
            ->assertJsonPath('config.utilization', .75)->assertJsonMissingPath('user_id')->assertJsonMissingPath('payload_hash');
    }

    public function test_malformed_nested_values_and_unsupported_fields_are_rejected(): void
    {
        $this->login();
        $payload = $this->payload();
        $payload['config']['controller']['initialFlow'] = 6;
        $this->postJson('/api/runs', $payload)->assertUnprocessable();
        $payload = $this->payload();
        $payload['summary']['armA']['totalOxygenL'] = 'NaN';
        $this->postJson('/api/runs', $payload)->assertUnprocessable();
        $payload = $this->payload();
        $payload['user_id'] = 999;
        $this->postJson('/api/runs', $payload)->assertUnprocessable();
        $payload = $this->payload();
        $payload['config']['controller']['maxOpenTimeS'] = .15;
        $this->postJson('/api/runs', $payload)->assertUnprocessable();
    }

    public function test_coverage_gas_arithmetic_and_time_bounds_are_checked(): void
    {
        $this->login();
        $payload = $this->payload();
        $payload['summary']['armB']['missingS'] = 1;
        $this->postJson('/api/runs', $payload)->assertUnprocessable();
        $payload = $this->payload();
        $payload['summary']['oxygenSavedPct'] = 80;
        $this->postJson('/api/runs', $payload)->assertUnprocessable();
        $payload = $this->payload();
        $payload['event_log'][0]['timeS'] = 2;
        $this->postJson('/api/runs', $payload)->assertUnprocessable();
    }

    public function test_zero_baseline_has_no_percentage_and_negative_reduction_is_preserved(): void
    {
        $this->login();
        $payload = $this->payload();
        $payload['config']['continuousFlow'] = 0;
        $payload['summary']['armA']['totalOxygenL'] = 0;
        $payload['summary']['oxygenSavedPct'] = null;
        foreach ($payload['series'] as &$point) {
            $point['flowA'] = $point['actualFlowA'] = 0;
        }
        unset($point);
        $this->postJson('/api/runs', $payload)->assertCreated()->assertJsonPath('summary.oxygenSavedPct', null);
        $payload['client_run_id'] = '83d92104-afbd-40ef-97aa-63e3c40acda9';
        $payload['config']['continuousFlow'] = 1;
        $payload['summary']['armA']['totalOxygenL'] = 1 / 60;
        $payload['summary']['oxygenSavedPct'] = -400;
        foreach ($payload['series'] as &$point) {
            $point['flowA'] = $point['actualFlowA'] = 1;
        }
        unset($point);
        $this->postJson('/api/runs', $payload)->assertCreated()->assertJsonPath('summary.oxygenSavedPct', -400);
    }

    public function test_legacy_records_stay_preserved_and_unowned(): void
    {
        Run::create(['scenario' => 'recovering', 'seed' => 42, 'summary' => ['old' => true], 'event_log' => []]);
        $this->login();
        $this->getJson('/api/runs')->assertExactJson([]);
        $this->assertDatabaseHas('runs', ['legacy' => true, 'user_id' => null]);
    }

    public function test_zero_duration_has_no_intervals_or_coverage_percentage(): void
    {
        $this->login();
        $payload = $this->payload();
        $payload['config']['durationS'] = $payload['summary']['simDurationS'] = 0;
        foreach (['armA', 'armB'] as $arm) {
            foreach ($payload['summary'][$arm] as $key => $value) {
                $payload['summary'][$arm][$key] = $key === 'validCoveragePct' ? null : 0;
            }
        }
        $payload['summary']['oxygenSavedPct'] = null;
        $payload['series'] = $payload['event_log'] = [];
        $this->postJson('/api/runs', $payload)->assertCreated()
            ->assertJsonPath('summary.simDurationS', 0)->assertJsonPath('summary.armB.validCoveragePct', null);
    }

    public function test_strict_json_types_and_complete_history_boundaries_are_required(): void
    {
        $this->login();
        $payload = $this->payload();
        $payload['series'][0]['valveB'] = 1;
        $this->postJson('/api/runs', $payload)->assertUnprocessable();
        $payload = $this->payload();
        $payload['provenance']['schemaVersion'] = 2;
        $this->postJson('/api/runs', $payload)->assertUnprocessable();
        $payload = $this->payload();
        $payload['series'] = [];
        $this->postJson('/api/runs', $payload)->assertUnprocessable();
        $payload = $this->payload();
        $payload['summary']['armB']['alarmEpisodes'] = 1;
        $this->postJson('/api/runs', $payload)->assertUnprocessable();
    }

    public function test_all_finite_negative_ratios_and_overflow_null_are_preserved(): void
    {
        $this->login();
        foreach ([1.0e-20, 1.0e-310] as $index => $baseline) {
            $payload = $this->payload();
            $payload['client_run_id'] = $index === 0 ? '83d92104-afbd-40ef-97aa-63e3c40acda9' : 'e4e4263e-86ae-4628-96bc-7deae2929418';
            $flow = $baseline * 60;
            $payload['config']['continuousFlow'] = $flow;
            $payload['summary']['armA']['totalOxygenL'] = $baseline;
            $ratio = ($baseline - $payload['summary']['armB']['totalOxygenL']) / $baseline * 100;
            $payload['summary']['oxygenSavedPct'] = is_finite($ratio) ? $ratio : null;
            foreach ($payload['series'] as &$point) {
                $point['flowA'] = $point['actualFlowA'] = $flow;
            }
            unset($point);
            $this->postJson('/api/runs', $payload)->assertCreated()
                ->assertJsonPath('summary.oxygenSavedPct', $payload['summary']['oxygenSavedPct']);
        }
    }

    public function test_save_limits_do_not_double_count_general_requests(): void
    {
        $this->login();
        for ($i = 0; $i < 10; $i++) {
            $this->postJson('/api/runs', $this->payload())->assertSuccessful();
        }
        $this->postJson('/api/runs', $this->payload())->assertTooManyRequests();
        $this->getJson('/api/runs')->assertOk();
    }

    public function test_missing_provider_uses_explicit_template_and_stable_event_identifier(): void
    {
        $this->login();
        $id = $this->postJson('/api/runs', $this->payload())->assertCreated()->json('id');
        $this->postJson('/api/ai/handover', ['run_id' => $id])->assertOk()->assertJsonPath('source', 'template')
            ->assertJsonPath('reason', 'AI key or model is not configured.');
        $this->postJson('/api/ai/explain-event', ['run_id' => $id, 'event_id' => 'event-1'])->assertOk()
            ->assertJsonPath('source', 'template');
        $this->postJson('/api/ai/explain-event', ['run_id' => $id, 'event_id' => 'absent'])->assertNotFound();
        Http::assertNothingSent();
    }

    public function test_provider_receives_early_faults_and_mock_failure_returns_template(): void
    {
        $this->login();
        $payload = $this->payload();
        for ($i = 2; $i < 50; $i++) {
            $payload['event_log'][] = ['id' => 'event-'.$i, 'timeS' => $i / 100, 'code' => 'PULSE', 'message' => 'Routine event'];
        }
        $id = $this->postJson('/api/runs', $payload)->assertCreated()->json('id');
        config(['services.ai.provider' => 'openai', 'services.ai.api_key' => 'mock-secret', 'services.ai.model' => 'mock-model']);
        Http::fake(['api.openai.com/*' => Http::sequence()
            ->push(['choices' => [['message' => ['content' => 'Simulation explanation.']]]])
            ->push(['error' => 'secret upstream response'], 503)]);
        $this->postJson('/api/ai/ask', ['run_id' => $id, 'question' => 'What happened early?'])->assertOk()->assertJsonPath('source', 'ai');
        Http::assertSent(fn ($request) => str_contains($request['messages'][1]['content'], 'Early simulated sensor fault.'));
        $this->postJson('/api/ai/handover', ['run_id' => $id])->assertOk()->assertJsonPath('source', 'template')
            ->assertJsonPath('reason', 'AI provider returned an error.');
    }
}
