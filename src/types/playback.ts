import type { PairHistory } from './candleTypes';

export interface PlaybackState {
  current_step: number;
  total_steps: number;
  speed: number;
  playing: boolean;
}

export interface PlaybackInitPayload {
  pair: string;
  timeframe: string;
  timerange?: string;
  limit?: number;
  candle_type?: string;
  selected_cols?: string[];
  strategy?: string;
}

export interface PlaybackControlPayload {
  action: 'play' | 'pause' | 'next' | 'previous' | 'reverse' | 'reset' | 'speed' | 'set_step';
  speed?: number;
  step?: number;
  limit?: number;
  selected_cols?: string[];
}

export interface PlaybackStateParams {
  limit?: number;
}

export interface PlaybackResponse {
  state: PlaybackState;
  data: PairHistory;
}
