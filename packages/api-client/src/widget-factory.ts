import type { WidgetApiClient } from './widget-client';
import {
  createMockWidgetClient,
  createHttpWidgetClient,
  type MockWidgetOptions,
} from './adapters/widget-adapters';
import type { ApiAdapterKind } from './factory';

/**
 * Adapter selector for the WIDGET client. Kept entirely separate from the admin
 * factory so the widget bundle never pulls in admin-adapter code
 * (Space Instructions §1, §6.3).
 */
export interface CreateWidgetClientConfig {
  adapter: ApiAdapterKind;
  baseUrl?: string;
  mock?: MockWidgetOptions;
}

export function createWidgetClient(config: CreateWidgetClientConfig): WidgetApiClient {
  if (config.adapter === 'http') {
    if (!config.baseUrl) {
      throw new Error('createWidgetClient: baseUrl is required when adapter="http".');
    }
    return createHttpWidgetClient(config.baseUrl);
  }
  return createMockWidgetClient(config.mock);
}
