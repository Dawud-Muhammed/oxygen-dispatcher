<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

class ResearchAccess
{
    public function handle(Request $request, Closure $next): Response
    {
        abort_unless($request->bearerToken() || app()->environment('testing'), 401);
        abort_unless($request->user()?->tokenCan('research'), 403);
        abort_if(strlen($request->getContent()) > 8 * 1024 * 1024, 413, 'Research payload exceeds 8 MiB.');
        return $next($request);
    }
}
