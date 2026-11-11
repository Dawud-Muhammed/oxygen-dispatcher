<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

class ReplayAiRequest extends FormRequest
{
    protected function prepareForValidation(): void
    {
        abort_if(strlen($this->getContent()) > 16 * 1024, 413, 'Replay request exceeds 16 KiB.');
    }

    public function rules(): array
    {
        return [
            'subject_id' => ['required', 'string', 'regex:/\A[0-9]{2}\z/'],
            'view' => ['required', 'in:valve,spo2'],
            'action' => ['required', 'in:explain,ask,handover'],
            'start_s' => ['required', 'numeric', 'min:0'],
            'end_s' => ['required', 'numeric', 'gte:start_s'],
            'event_id' => ['required_if:action,explain', 'nullable', 'string', 'max:128'],
            'question' => ['required_if:action,ask', 'nullable', 'string', 'max:500'],
            'history' => ['exclude_unless:action,ask', 'sometimes', 'array', 'list', 'max:3'],
            'history.*' => ['required', 'string', 'max:500'],
        ];
    }
}
