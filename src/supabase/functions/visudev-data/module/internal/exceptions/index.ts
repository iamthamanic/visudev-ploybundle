export interface ErrorDetailsEntry {
  field?: string;
  message: string;
}

export class ModuleException extends Error {
  public readonly statusCode: number;
  public readonly code: string;
  public readonly details?: ErrorDetailsEntry[];

  constructor(
    message: string,
    statusCode: number = 500,
    code: string = "INTERNAL_ERROR",
    details?: ErrorDetailsEntry[],
  ) {
    super(message);
    this.name = "ModuleException";
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

export class ValidationException extends ModuleException {
  constructor(message: string, details?: ErrorDetailsEntry[]) {
    super(message, 400, "VALIDATION_ERROR", details);
    this.name = "ValidationException";
  }
}

export class NotFoundException extends ModuleException {
  constructor(resource: string) {
    super(`${resource} not found`, 404, "NOT_FOUND");
    this.name = "NotFoundException";
  }
}

export class ForbiddenException extends ModuleException {
  constructor(message: string = "Not authorized to access this resource") {
    super(message, 403, "FORBIDDEN");
    this.name = "ForbiddenException";
  }
}

export class RepositoryException extends ModuleException {
  constructor(message: string) {
    super(message, 500, "REPOSITORY_ERROR");
    this.name = "RepositoryException";
  }
}
