<?php

namespace App\Providers;

use Illuminate\Cache\RateLimiting\Limit;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\ServiceProvider;

class AppServiceProvider extends ServiceProvider
{
    /**
     * Register any application services.
     */
    public function register(): void
    {
        //
    }

    /**
     * Bootstrap any application services.
     */
    public function boot(): void
    {
        // Independent names prevent a request from incrementing the same bucket twice.
        RateLimiter::for('research', fn (Request $request) => Limit::perMinute(60)->by('all:'.$request->user()->id));
        RateLimiter::for('research-saves', fn (Request $request) => Limit::perMinute(10)->by('save:'.$request->user()->id));
        RateLimiter::for('research-ai', fn (Request $request) => Limit::perMinute(10)->by('ai:'.$request->user()->id));
    }
}
