/**
 * Tester Service
 * 
 * Tests code locally on the server
 * Checks out agent's branch, runs tests, returns results
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import { logger } from '../utils/logger';

const execAsync = promisify(exec);

interface TestResult {
  success: boolean;
  output: string;
  errors?: string[];
  testCommand?: string;
  buildCommand?: string;
  lintCommand?: string;
}

class TesterService {
  private readonly projectPath: string;

  constructor() {
    this.projectPath = process.env['PROJECT_PATH'] || '';
    if (!this.projectPath) {
      logger.warn('PROJECT_PATH not set - testing will be disabled');
    }
  }

  /**
   * Test a branch
   */
  async testBranch(branchName: string, agentId: string): Promise<TestResult> {
    if (!this.projectPath) {
      return {
        success: false,
        output: 'PROJECT_PATH not configured',
        errors: ['PROJECT_PATH environment variable is required']
      };
    }

    let originalBranch = 'main';
    
    try {
      logger.info('Starting branch test', { agentId, branchName, projectPath: this.projectPath });

      // 1. Save current branch
      try {
        const { stdout } = await execAsync('git branch --show-current', { cwd: this.projectPath });
        originalBranch = stdout.trim() || 'main';
        logger.info('Current branch saved', { originalBranch });
      } catch (error) {
        logger.warn('Could not determine current branch, assuming main', { error });
      }

      // 2. Fetch latest
      await execAsync('git fetch origin', { cwd: this.projectPath });
      logger.info('Fetched latest from origin');

      // 3. Checkout agent's branch
      await execAsync(`git checkout ${branchName}`, { cwd: this.projectPath });
      logger.info('Checked out branch', { branchName });

      // 4. Determine test commands
      const commands = this.determineTestCommands(this.projectPath);

      // 5. Run tests
      const results = await this.runTests(commands);

      // 6. Return to original branch
      await execAsync(`git checkout ${originalBranch}`, { cwd: this.projectPath });
      logger.info('Returned to original branch', { originalBranch });

      return results;
    } catch (error) {
      // Always try to return to original branch
      try {
        await execAsync(`git checkout ${originalBranch}`, { cwd: this.projectPath });
        logger.info('Returned to original branch after error', { originalBranch });
      } catch (checkoutError) {
        logger.error('Failed to return to original branch', { originalBranch, error: checkoutError });
      }

      logger.error('Branch test failed', { agentId, branchName, error });
      return {
        success: false,
        output: error instanceof Error ? error.message : String(error),
        errors: [error instanceof Error ? error.message : String(error)]
      };
    }
  }

  /**
   * Determine test commands based on project type
   */
  private determineTestCommands(projectPath: string): {
    install: string;
    test: string;
    lint: string;
    build: string;
  } {
    // Default commands (can be enhanced with project detection)
    return {
      install: 'npm install',
      test: 'npm test',
      lint: 'npm run lint',
      build: 'npm run build'
    };
  }

  /**
   * Run test suite
   */
  private async runTests(commands: {
    install: string;
    test: string;
    lint: string;
    build: string;
  }): Promise<TestResult> {
    const errors: string[] = [];
    const output: string[] = [];

    try {
      // 1. Install dependencies
      logger.info('Installing dependencies');
      try {
        const { stdout, stderr } = await execAsync(commands.install, {
          cwd: this.projectPath,
          timeout: 300000 // 5 minutes
        });
        output.push(`Install: ${stdout}`);
        if (stderr) output.push(`Install stderr: ${stderr}`);
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        errors.push(`Install failed: ${errorMsg}`);
        output.push(`Install error: ${errorMsg}`);
      }

      // 2. Run linter
      logger.info('Running linter');
      try {
        const { stdout, stderr } = await execAsync(commands.lint, {
          cwd: this.projectPath,
          timeout: 120000 // 2 minutes
        });
        output.push(`Lint: ${stdout}`);
        if (stderr) output.push(`Lint stderr: ${stderr}`);
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        errors.push(`Lint failed: ${errorMsg}`);
        output.push(`Lint error: ${errorMsg}`);
      }

      // 3. Run tests
      logger.info('Running tests');
      try {
        const { stdout, stderr } = await execAsync(commands.test, {
          cwd: this.projectPath,
          timeout: 300000 // 5 minutes
        });
        output.push(`Test: ${stdout}`);
        if (stderr) output.push(`Test stderr: ${stderr}`);
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        errors.push(`Test failed: ${errorMsg}`);
        output.push(`Test error: ${errorMsg}`);
      }

      // 4. Build
      logger.info('Running build');
      try {
        const { stdout, stderr } = await execAsync(commands.build, {
          cwd: this.projectPath,
          timeout: 300000 // 5 minutes
        });
        output.push(`Build: ${stdout}`);
        if (stderr) output.push(`Build stderr: ${stderr}`);
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        errors.push(`Build failed: ${errorMsg}`);
        output.push(`Build error: ${errorMsg}`);
      }

      const success = errors.length === 0;

      return {
        success,
        output: output.join('\n\n'),
        errors: errors.length > 0 ? errors : undefined,
        testCommand: commands.test,
        buildCommand: commands.build,
        lintCommand: commands.lint
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        output: output.join('\n\n'),
        errors: [...errors, errorMsg]
      };
    }
  }

  /**
   * Generate fix instructions from test results
   */
  async generateFixInstructions(testResult: TestResult): Promise<string> {
    if (testResult.success) {
      return 'All tests passed! Great work.';
    }

    let instructions = 'The following issues were found during testing:\n\n';

    if (testResult.errors) {
      testResult.errors.forEach((error, index) => {
        instructions += `${index + 1}. ${error}\n`;
      });
    }

    instructions += '\nPlease fix these issues and try again.';

    return instructions;
  }
}

export const tester = new TesterService();

