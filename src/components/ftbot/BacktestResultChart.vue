<script setup lang="ts">
import type { ChartSliderPosition, PlaybackControlPayload, PlaybackState, StrategyBacktestResult, Trade } from '@/types';

const props = defineProps<{
  timeframe: string;
  strategy: string;
  freqaiModel?: string;
  timerange: string;
  backtestResult: StrategyBacktestResult;
}>();
const botStore = useBotStore();
const settingsStore = useSettingsStore();
const plotStore = usePlotConfigStore();
const isBarVisible = ref({ right: true, left: true });
const sliderPosition = ref<ChartSliderPosition>();
const playbackState = ref<PlaybackState | null>(null);
const playbackStep = ref(0);
const playbackSpeed = ref(1);
const playbackPolling = ref<number | null>(null);
const playbackLoading = ref(false);
const stepChangeTimer = ref<number | null>(null);

const playbackReady = computed(() => playbackState.value !== null);
const playbackMaxStep = computed(() =>
  Math.max(0, (playbackState.value?.total_steps ?? 1) - 1),
);
const playbackLimit = computed(() => Math.max(50, settingsStore.chartDefaultCandleCount || 500));
const activePair = computed(() => botStore.activeBot.selectedPair || props.backtestResult.pairlist[0]);
const activeHistory = computed(() => {
  const pair = activePair.value;
  if (!pair) return undefined;
  return botStore.activeBot.history[`${pair}__${props.timeframe}`]?.data;
});

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function navigateChartToTrade(trade: Trade) {
  const openTs = trade.open_fill_timestamp ?? trade.open_timestamp;
  const closeTs = trade.close_timestamp ?? undefined;

  sliderPosition.value = {
    startValue: openTs,
    endValue: closeTs,
  };

  if (!playbackReady.value) return;

  const timeframeMs = activeHistory.value?.timeframe_ms;
  if (!timeframeMs) return;

  const startTs = props.backtestResult.backtest_start_ts;
  const rawStep = Math.floor((openTs - startTs) / timeframeMs);
  const targetStep = clamp(rawStep, 0, playbackMaxStep.value);

  if (targetStep === playbackStep.value) return;
  playbackStep.value = targetStep;
  void updatePlayback({ action: 'set_step', step: targetStep });
}

function stopPlaybackPolling() {
  if (playbackPolling.value) {
    clearInterval(playbackPolling.value);
    playbackPolling.value = null;
  }
}

function startPlaybackPolling() {
  if (playbackPolling.value) return;
  playbackPolling.value = window.setInterval(async () => {
    try {
      const response = await botStore.activeBot.playbackState({ limit: playbackLimit.value });
      playbackState.value = response.state;
    } catch (err) {
      stopPlaybackPolling();
    }
  }, 500);
}

async function refreshOHLCV(pair: string, columns: string[]) {
  const selectedColumns = columns?.length ? columns : plotStore.usedColumns;
  stopPlaybackPolling();
  playbackLoading.value = true;
  try {
    const response = await botStore.activeBot.playbackInit({
      pair: pair,
      timeframe: props.timeframe,
      timerange: props.timerange || undefined,
      limit: playbackLimit.value,
      selected_cols: selectedColumns,
      strategy: props.strategy,
    });
    playbackState.value = response.state;
    return;
  } catch (err) {
    playbackState.value = null;
  } finally {
    playbackLoading.value = false;
  }

  botStore.activeBot.getPairHistory({
    pair: pair,
    timeframe: props.timeframe,
    timerange: props.timerange,
    strategy: props.strategy,
    freqaimodel: props.freqaiModel,
    columns: selectedColumns,
    margin_mode: props.backtestResult.margin_mode,
    trading_mode: props.backtestResult.trading_mode,
  });
}

async function updatePlayback(payload: PlaybackControlPayload) {
  if (!playbackReady.value) return;
  const response = await botStore.activeBot.playbackControl({
    ...payload,
    limit: playbackLimit.value,
    selected_cols: plotStore.usedColumns,
  });
  playbackState.value = response.state;
}

async function togglePlayback() {
  if (!playbackReady.value) return;
  if (playbackState.value?.playing) {
    await updatePlayback({ action: 'pause' });
  } else {
    await updatePlayback({ action: 'play' });
  }
}

async function stepPrevious() {
  await updatePlayback({ action: 'previous' });
}

async function stepNext() {
  await updatePlayback({ action: 'next' });
}

async function changeSpeed() {
  if (!playbackReady.value) return;
  if (playbackSpeed.value === playbackState.value?.speed) return;
  await updatePlayback({ action: 'speed', speed: playbackSpeed.value });
}

async function changeStep() {
  if (!playbackReady.value) return;
  if (playbackStep.value === playbackState.value?.current_step) return;
  await updatePlayback({ action: 'set_step', step: playbackStep.value });
}

function scheduleStepChange() {
  if (!playbackReady.value) return;
  if (stepChangeTimer.value) {
    clearTimeout(stepChangeTimer.value);
  }
  stepChangeTimer.value = window.setTimeout(() => {
    stepChangeTimer.value = null;
    void changeStep();
  }, 200);
}
onMounted(() => {
  if (!botStore.activeBot.selectedPair && props.backtestResult.pairlist.length > 0) {
    const [firstPair] = props.backtestResult.pairlist;
    if (firstPair) {
      botStore.activeBot.selectedPair = firstPair;
    }
  }
});

watch(
  () => playbackState.value,
  (state) => {
    if (!state) return;
    playbackStep.value = state.current_step;
    playbackSpeed.value = state.speed;
  },
);

watch(
  () => playbackState.value?.playing,
  (playing) => {
    if (playing) {
      startPlaybackPolling();
    } else {
      stopPlaybackPolling();
    }
  },
);

onBeforeUnmount(() => {
  stopPlaybackPolling();
  if (stepChangeTimer.value) {
    clearTimeout(stepChangeTimer.value);
    stepChangeTimer.value = null;
  }
});
</script>

<template>
  <div>
    <div class="flex flex-row mb-1 items-center">
      <div class="me-2">
        <Button
          aria-label="Close"
          title="Pair Navigation"
          severity="secondary"
          variant="outlined"
          size="small"
          @click="isBarVisible.left = !isBarVisible.left"
        >
          <i-mdi-chevron-right v-if="!isBarVisible.left" width="24" height="24" />
          <i-mdi-chevron-left v-if="isBarVisible.left" width="24" height="24" />
        </Button>
      </div>
      <span class="grow">
        Graph will always show the latest values for the selected strategy. <br />
        Timerange: {{ timerange }} - {{ strategy }}
      </span>
      <div class="text-end">
        <Button
          aria-label="Close"
          variant="outlined"
          title="Trade Navigation"
          size="small"
          severity="secondary"
          @click="isBarVisible.right = !isBarVisible.right"
        >
          <i-mdi-chevron-right v-if="isBarVisible.right" width="24" height="24" />
          <i-mdi-chevron-left v-if="!isBarVisible.right" width="24" height="24" />
        </Button>
      </div>
    </div>
    <div class="flex flex-wrap items-center gap-2 mb-2 border-b border-surface-200 dark:border-surface-800 pb-2 overflow-hidden">
      <span class="text-sm font-medium">Playback</span>
      <Button
        size="small"
        severity="secondary"
        :disabled="!playbackReady || playbackLoading"
        @click="togglePlayback"
      >
        <template #icon>
          <i-mdi-pause v-if="playbackState?.playing" width="14" height="14" />
          <i-mdi-play v-else width="14" height="14" />
        </template>
      </Button>
      <Button
        size="small"
        severity="secondary"
        :disabled="!playbackReady || playbackLoading"
        @click="stepPrevious"
        title="Previous candle"
      >
        <template #icon>
          <i-mdi-step-backward width="14" height="14" />
        </template>
      </Button>
      <Button
        size="small"
        severity="secondary"
        :disabled="!playbackReady || playbackLoading"
        @click="stepNext"
        title="Next candle"
      >
        <template #icon>
          <i-mdi-step-forward width="14" height="14" />
        </template>
      </Button>
      <div class="flex items-center gap-2 flex-none max-w-full min-w-0">
        <span class="text-sm">Speed</span>
        <InputNumber
          v-model="playbackSpeed"
          :min="1"
          :max="5"
          :step="1"
          :use-grouping="false"
          size="small"
          class="w-16"
          :disabled="!playbackReady || playbackLoading"
          @change="changeSpeed"
        />
        <Slider
          v-model="playbackSpeed"
          :min="1"
          :max="5"
          :step="1"
          class="w-24 min-w-0 -ml-4"
          :disabled="!playbackReady || playbackLoading"
          @change="changeSpeed"
        />
      </div>
      <div class="flex items-center gap-2 flex-1 min-w-56 ps-4">
        <span class="text-sm">Step</span>
        <Slider
          v-model="playbackStep"
          :min="0"
          :max="playbackMaxStep"
          :step="1"
          class="w-full ms-2"
          :disabled="!playbackReady || playbackLoading"
          @change="scheduleStepChange"
        />
        <small v-if="playbackReady" class="text-nowrap">
          {{ playbackState?.current_step + 1 }} / {{ playbackState?.total_steps }}
        </small>
        <ProgressSpinner v-if="playbackLoading" class="w-4 h-4" stroke-width="4" />
      </div>
    </div>
    <div class="text-center flex flex-row h-full items-stretch overflow-x-clip">
      <Transition name="fadeleft">
        <PairSummary
          v-if="isBarVisible.left"
          class="overflow-y-auto overflow-x-hidden"
          style="max-height: calc(100vh - 200px)"
          :pairlist="backtestResult.pairlist"
          :trades="backtestResult.trades"
          :starting-balance="backtestResult.starting_balance"
          sort-method="profit"
          :backtest-mode="true"
        />
      </Transition>
      <CandleChartContainer
        :available-pairs="backtestResult.pairlist"
        historic-view
        reload-data-on-switch
        :timeframe="timeframe"
        :timerange="timerange"
        :strategy="strategy"
        :trades="backtestResult.trades"
        class="flex-1 candle-chart-container px-0 h-full align-self-stretch min-w-0 overflow-y-auto"
        :slider-position="sliderPosition"
        :freqai-model="freqaiModel"
        @refresh-data="refreshOHLCV"
      >
      </CandleChartContainer>
      <Transition name="fade">
        <TradeListNav
          v-if="isBarVisible.right"
          class="overflow-y-auto overflow-x-visible min-w-56"
          style="max-height: calc(100vh - 200px)"
          :trades="backtestResult.trades.filter((t) => t.pair === botStore.activeBot.selectedPair)"
          @trade-select="navigateChartToTrade"
        />
      </Transition>
    </div>
    <DraggableContainer header="Single trades" class="row mt-2 w-full">
      <TradeList
        class="row trade-history mt-2 w-full"
        :trades="backtestResult.trades"
        :show-filter="true"
      />
    </DraggableContainer>
  </div>
</template>

<style lang="css" scoped>
.candle-chart-container {
  /* TODO: Rough estimate - still to fix correctly
   Applies to all "calc" usages in this file. */
  height: calc(100vh - 250px) !important;
}

.fade-enter-active,
.fade-leave-active {
  transition: all 0.2s;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
  transform: translateX(30px);
}
.fadeleft-enter-active,
.fadeleft-leave-active {
  transition: all 0.2s;
}

.fadeleft-enter-from,
.fadeleft-leave-to {
  opacity: 0;
  transform: translateX(-30px);
}
</style>
