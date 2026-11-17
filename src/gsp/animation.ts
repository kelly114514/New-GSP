/** 动画按钮 2003 记录中的速度、周期和范围。 */
import type { ButtonAction, Id, UnitKind } from '../core/model';
import { CM } from '../core/expr';

type AnimateButton = Extract<ButtonAction, { type: 'animate' }>;
export const ANIMATION_SPEED_FIELDS = { slow: 4, medium: 24, fast: 80 };
const UNIT_FLAGS = { none: 0, distance: 0x200, angle: 0x400 };
const FILE_UNITS = { none: 1, distance: CM, angle: Math.PI / 180 };

export function defaultParameterAnimation(unit: UnitKind) {
  return { amount: unit === 'angle' ? 45 : 1, interval: 1, min: unit === 'none' ? -100 : 0,
    max: { none: 100, angle: 360, distance: 102.19 }[unit], discrete: false, once: false };
}

export function animationSpeedFromFile(field: number): AnimateButton['speed'] | undefined {
  if (field === 4) return 'slow';
  if (field === 24) return 'medium';
  if (field === 80) return 'fast';
  if (Number.isFinite(field) && field > 0) return field;
  return undefined;
}

/** 每个二进制区间中，有效数字按原版的指数缩放；奇数指数的区间从 0 开始。 */
export function animationScalar(field: number): number {
  if (field === 0 || !Number.isFinite(field)) return field;
  const magnitude = Math.abs(field), exponent = Math.floor(Math.log2(magnitude));
  const scale = 2 ** (Math.floor(exponent / 2) + 1);
  const offset = exponent % 2 === 0 ? 0 : 2 ** exponent;
  return Math.sign(field) * (magnitude - offset) / scale;
}

export function originalAnimationOptions(value: string | undefined): Uint8Array | undefined {
  if (!value || !/^[A-Za-z0-9+/]{48}$/.test(value)) return undefined;
  const raw = Uint8Array.from(atob(value), c => c.charCodeAt(0));
  if (raw[0] !== 62 || raw[1] !== 0) return undefined;
  return raw;
}

export function parameterAnimation(action: AnimateButton, unit: UnitKind) {
  const bytes = originalAnimationOptions(action.gspOptions);
  if (!bytes) return undefined;
  const options = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const flags = options.getUint16(6, true), fileUnit = flags & 0x600;
  if (fileUnit !== UNIT_FLAGS[unit]) return undefined;
  const scale = FILE_UNITS[unit];
  const speed = typeof action.speed === 'number' ? action.speed : ANIMATION_SPEED_FIELDS[action.speed];
  const amount = animationScalar(speed) / scale;
  const interval = animationScalar(options.getFloat32(12, true));
  const min = animationScalar(options.getFloat32(16, true)) / scale;
  const max = animationScalar(options.getFloat32(20, true)) / scale;
  if (![amount, interval, min, max].every(Number.isFinite) || interval <= 0 || min >= max) return undefined;
  return { amount, interval, min, max, discrete: !!(flags & 0x800), once: !!action.once };
}

function parameterField(value: number): number {
  const rounded = Math.fround(value);
  return rounded === 0 ? 0 : Math.fround(rounded * 2 ** (Math.floor(Math.log2(Math.abs(rounded))) + 2));
}

export function makeParameterAnimation(targets: Id[], unit: UnitKind, direction: AnimateButton['direction'], settings: {
  amount: number; interval: number; min: number; max: number; discrete: boolean; once: boolean;
}): AnimateButton {
  const { amount, interval, min, max, discrete, once } = settings;
  const factor = FILE_UNITS[unit];
  const speed = animationSpeedFromFile(parameterField(amount * factor));
  if (!speed || interval <= 0 || min >= max) throw new Error('变化量和间隔必须大于零，下限必须小于上限。');
  const record = new Uint8Array(36), view = new DataView(record.buffer);
  view.setUint16(0, 62, true);
  view.setUint16(6, UNIT_FLAGS[unit] | (discrete ? 0x800 : 0), true);
  view.setFloat32(12, parameterField(interval), true);
  view.setFloat32(16, parameterField(min * factor), true);
  view.setFloat32(20, parameterField(max * factor), true);
  const action: AnimateButton = { type: 'animate', targets, speed, direction, ...(once ? { once: true } : {}), gspOptions: btoa(String.fromCharCode(...record)) };
  if (!parameterAnimation(action, unit)) throw new Error('这些数值超出了动画记录能够表示的范围。');
  return action;
}
