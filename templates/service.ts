/**
 * Service Template
 *
 * Purpose:
 * - Provide a starting point for application/domain services that
 *   encapsulate business logic and depend on abstractions (interfaces),
 *   not concrete implementations.
 */
export interface ExampleServiceDependencies {
  // exampleRepository: ExampleRepositoryInterface;
}

export class ExampleService {
  constructor(private readonly deps: ExampleServiceDependencies) {}

  // Example method signature
  async executeExample(input: { id: string }): Promise<void> {
    // Business logic goes here.
    // Use this.deps.* to access repositories or integrations.
  }
}
