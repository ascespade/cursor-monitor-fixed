/**
 * Quality Scorer Service
 * 
 * Calculates quality score (0-100) for orchestration results
 * Based on iterations, tests, errors, code quality
 */

import { logger } from '../utils/logger';

export interface QualityMetrics {
  iterations: number;
  maxIterations: number;
  testsPassed: number;
  testsTotal: number;
  errorsFixed: number;
  errorsTotal: number;
  codeQuality?: number; // 0-100 (from linter, complexity, etc.)
  testCoverage?: number; // 0-100
}

export interface QualityScore {
  score: number; // 0-100
  grade: 'A' | 'B' | 'C' | 'D' | 'F';
  breakdown: {
    iterations: number; // 0-25 points
    tests: number; // 0-30 points
    errors: number; // 0-25 points
    quality: number; // 0-20 points
  };
  recommendations: string[];
}

class QualityScorerService {
  /**
   * Calculate quality score from metrics
   */
  calculateScore(metrics: QualityMetrics): QualityScore {
    const breakdown = {
      iterations: this.scoreIterations(metrics.iterations, metrics.maxIterations),
      tests: this.scoreTests(metrics.testsPassed, metrics.testsTotal),
      errors: this.scoreErrors(metrics.errorsFixed, metrics.errorsTotal),
      quality: this.scoreQuality(metrics.codeQuality, metrics.testCoverage)
    };

    const totalScore = Object.values(breakdown).reduce((sum, score) => sum + score, 0);

    const grade = this.getGrade(totalScore);
    const recommendations = this.getRecommendations(breakdown, metrics);

    return {
      score: Math.round(totalScore),
      grade,
      breakdown,
      recommendations
    };
  }

  /**
   * Score based on iterations (fewer is better)
   * Max 25 points
   */
  private scoreIterations(iterations: number, maxIterations: number): number {
    if (iterations === 0) return 0;
    
    const ratio = iterations / maxIterations;
    if (ratio <= 0.2) return 25; // Excellent
    if (ratio <= 0.4) return 20; // Good
    if (ratio <= 0.6) return 15; // Average
    if (ratio <= 0.8) return 10; // Below average
    return 5; // Poor
  }

  /**
   * Score based on tests (more passed is better)
   * Max 30 points
   */
  private scoreTests(passed: number, total: number): number {
    if (total === 0) return 15; // No tests = neutral
    
    const ratio = passed / total;
    return Math.round(ratio * 30);
  }

  /**
   * Score based on errors (fewer is better)
   * Max 25 points
   */
  private scoreErrors(fixed: number, total: number): number {
    if (total === 0) return 25; // No errors = perfect
    
    const ratio = fixed / total;
    return Math.round(ratio * 25);
  }

  /**
   * Score based on code quality metrics
   * Max 20 points
   */
  private scoreQuality(codeQuality?: number, testCoverage?: number): number {
    let score = 10; // Base score

    if (codeQuality !== undefined) {
      score += (codeQuality / 100) * 10; // Up to 10 points
    }

    if (testCoverage !== undefined) {
      score += (testCoverage / 100) * 10; // Up to 10 points
    }

    return Math.min(20, Math.round(score));
  }

  /**
   * Get letter grade
   */
  private getGrade(score: number): 'A' | 'B' | 'C' | 'D' | 'F' {
    if (score >= 90) return 'A';
    if (score >= 80) return 'B';
    if (score >= 70) return 'C';
    if (score >= 60) return 'D';
    return 'F';
  }

  /**
   * Get recommendations for improvement
   */
  private getRecommendations(
    breakdown: QualityScore['breakdown'],
    metrics: QualityMetrics
  ): string[] {
    const recommendations: string[] = [];

    if (breakdown.iterations < 15) {
      recommendations.push('Consider reducing iterations by improving task clarity');
    }

    if (breakdown.tests < 20) {
      recommendations.push('Add more tests to improve reliability');
    }

    if (breakdown.errors < 15) {
      recommendations.push('Review error handling and validation');
    }

    if (breakdown.quality < 15) {
      recommendations.push('Improve code quality: refactor, add documentation, reduce complexity');
    }

    if (metrics.testCoverage && metrics.testCoverage < 80) {
      recommendations.push(`Increase test coverage from ${metrics.testCoverage}% to at least 80%`);
    }

    return recommendations;
  }

  /**
   * Check if quality score meets threshold
   */
  meetsThreshold(score: QualityScore, threshold: number = 70): boolean {
    return score.score >= threshold;
  }
}

export const qualityScorer = new QualityScorerService();
