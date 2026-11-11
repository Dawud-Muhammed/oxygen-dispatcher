<?php

use App\Models\User;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Validator;
use Illuminate\Support\Str;

Artisan::command('research:token {email} {--name=Researcher} {--revoke : Revoke existing tokens before issuing a new one}', function () {
    $values = ['email' => $this->argument('email'), 'name' => $this->option('name')];
    Validator::make($values, ['email' => 'required|email|max:255', 'name' => 'required|string|max:255'])->validate();
    $user = User::firstOrCreate(['email' => $values['email']], [
        'name' => $values['name'], 'password' => Hash::make(Str::random(64)),
    ]);
    if ($this->option('revoke')) {
        $user->tokens()->delete();
    }
    $this->warn('Keep this research token private. It expires in 30 days. Paste it into Saved runs in the research workspace.');
    $this->line($user->createToken('research-browser', ['research'], now()->addDays(30))->plainTextToken);
})->purpose('Provision an owner-scoped research account token from a trusted local terminal');
