export class ConfigCheckError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'ConfigCheckError';
    }
}

export class RateLimitError extends Error {
    public readonly retryAfter: number;

    constructor(retryAfter: number) {
        super('Rate limit exceeded');
        this.name = 'RateLimitError';
        this.retryAfter = retryAfter;
    }
}

export class PermissionDeniedError extends Error {
    public readonly requiredPermission: string;

    constructor(requiredPermission: string) {
        super('Permission denied');
        this.name = 'PermissionDeniedError';
        this.requiredPermission = requiredPermission;
    }
}