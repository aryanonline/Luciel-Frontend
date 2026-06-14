/**
 * DATA-PLANE entrypoint for the embeddable widget. The widget bundle imports
 * ONLY from here. It exposes the widget client + data-plane types and NOTHING
 * from the admin client/factory/adapters — enforcing the hard rule that the
 * widget bundle contains zero admin-API code (Space Instructions §1, §6.3).
 */
export type { WidgetApiClient } from './widget-client';
export { createWidgetClient, type CreateWidgetClientConfig } from './widget-factory';
export type { MockWidgetOptions } from './adapters/widget-adapters';

// Data-plane types only.
export type {
  WidgetBootstrap,
  WidgetMessage,
  WidgetSendRequest,
  WidgetSendResult,
  WidgetRenderState,
} from './schemas';
export { LucielApiError } from './schemas';
