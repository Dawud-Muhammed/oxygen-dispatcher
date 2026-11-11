<?php

namespace App\Http\Controllers;

use App\Http\Requests\StoreRunRequest;
use App\Models\Run;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class RunController extends Controller
{
    public function store(StoreRunRequest $request): JsonResponse
    {
        $data = $request->validated();
        // Shape and arithmetic checks do not independently verify simulations.
        $data['provenance']['verification'] = 'client-submitted';
        $hash = hash('sha256', json_encode($this->canonical($data), JSON_THROW_ON_ERROR | JSON_PRESERVE_ZERO_FRACTION));
        $key = ['user_id' => $request->user()->id, 'client_run_id' => $data['client_run_id']];
        $run = Run::firstOrCreate($key, [...$data, 'payload_hash' => $hash, 'legacy' => false]);
        if (!hash_equals($run->payload_hash ?? '', $hash)) {
            return response()->json(['message' => 'This run identifier has already been saved with different data.'], 409);
        }
        return response()->json($run, $run->wasRecentlyCreated ? 201 : 200);
    }

    public function index(Request $request): JsonResponse
    {
        return response()->json(Run::where('user_id', $request->user()->id)->latest('id')->limit(50)
            ->get(['id', 'client_run_id', 'scenario', 'created_at', 'summary', 'legacy']));
    }

    public function show(Request $request, string $id): JsonResponse
    {
        return response()->json(Run::where('user_id', $request->user()->id)->findOrFail($id));
    }

    private function canonical(mixed $value): mixed
    {
        if (!is_array($value)) {
            return $value;
        }
        if (!array_is_list($value)) {
            ksort($value);
        }
        return array_map($this->canonical(...), $value);
    }
}
