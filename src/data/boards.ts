export type Arch = 'riscv' | 'xtensa' | 'arm';
export type InstallMethod = 'rustup' | 'espup';

export interface BoardDefinition {
  id: string;
  name: string;
  vendor: string;
  chip: string;
  arch: Arch;
  target: string;
  installMethod: InstallMethod;
  espupTargets?: string;
  hal: string;
  halVersion: string;
  flashTool: string;
  description: string;
  infoUrl: string;
  /** Default `chip=` for `cargo generate` (embassy-template / stm32-template). */
  defaultCargoChip?: string;
}

export const VENDORS = ['Espressif', 'Raspberry Pi', 'STMicroelectronics'] as const;

export const BOARDS: BoardDefinition[] = [
  {
    id: 'esp32c3',
    name: 'ESP32-C3 Dev Module',
    vendor: 'Espressif',
    chip: 'ESP32-C3',
    arch: 'riscv',
    target: 'riscv32imc-unknown-none-elf',
    installMethod: 'rustup',
    hal: 'esp-hal',
    halVersion: '0.18.0',
    flashTool: 'espflash',
    description: 'Single-core RISC-V module, Wi-Fi + BLE 5.0. Ideal for low-cost IoT.',
    infoUrl: 'https://docs.espressif.com/projects/esp-idf/en/latest/esp32c3/',
  },
  {
    id: 'esp32c6',
    name: 'ESP32-C6 Dev Module',
    vendor: 'Espressif',
    chip: 'ESP32-C6',
    arch: 'riscv',
    target: 'riscv32imac-unknown-none-elf',
    installMethod: 'rustup',
    hal: 'esp-hal',
    halVersion: '0.18.0',
    flashTool: 'espflash',
    description: 'RISC-V with Wi-Fi 6, BLE 5.0 and Thread/Zigbee. Matter support.',
    infoUrl: 'https://docs.espressif.com/projects/esp-idf/en/latest/esp32c6/',
  },
  {
    id: 'esp32',
    name: 'ESP32 Dev Module',
    vendor: 'Espressif',
    chip: 'ESP32',
    arch: 'xtensa',
    target: 'xtensa-esp32-none-elf',
    installMethod: 'espup',
    espupTargets: 'esp32',
    hal: 'esp-hal',
    halVersion: '0.18.0',
    flashTool: 'espflash',
    description: 'Dual-core Xtensa LX6, Wi-Fi + BLE. The classic Espressif chip.',
    infoUrl: 'https://docs.espressif.com/projects/esp-idf/en/latest/esp32/',
  },
  {
    id: 'esp32s2',
    name: 'ESP32-S2 Dev Module',
    vendor: 'Espressif',
    chip: 'ESP32-S2',
    arch: 'xtensa',
    target: 'xtensa-esp32s2-none-elf',
    installMethod: 'espup',
    espupTargets: 'esp32s2',
    hal: 'esp-hal',
    halVersion: '0.18.0',
    flashTool: 'espflash',
    description: 'Single-core Xtensa LX7, Wi-Fi, native USB OTG. Security focused.',
    infoUrl: 'https://docs.espressif.com/projects/esp-idf/en/latest/esp32s2/',
  },
  {
    id: 'esp32s3',
    name: 'ESP32-S3 Dev Module',
    vendor: 'Espressif',
    chip: 'ESP32-S3',
    arch: 'xtensa',
    target: 'xtensa-esp32s3-none-elf',
    installMethod: 'espup',
    espupTargets: 'esp32s3',
    hal: 'esp-hal',
    halVersion: '0.18.0',
    flashTool: 'espflash',
    description: 'Dual-core Xtensa LX7, Wi-Fi + BLE 5.0, AI accelerator. High performance.',
    infoUrl: 'https://docs.espressif.com/projects/esp-idf/en/latest/esp32s3/',
  },
  {
    id: 'rp2040',
    name: 'Raspberry Pi Pico',
    vendor: 'Raspberry Pi',
    chip: 'RP2040',
    arch: 'arm',
    target: 'thumbv6m-none-eabi',
    installMethod: 'rustup',
    hal: 'rp-hal',
    halVersion: '0.10.0',
    flashTool: 'elf2uf2-rs',
    description: 'Dual-core ARM Cortex-M0+, 264KB SRAM, Programmable I/O (PIO).',
    infoUrl: 'https://www.raspberrypi.com/documentation/microcontrollers/rp2040.html',
    defaultCargoChip: 'rp2040',
  },
  {
    id: 'stm32f4',
    name: 'STM32F4 Discovery',
    vendor: 'STMicroelectronics',
    chip: 'STM32F407',
    arch: 'arm',
    target: 'thumbv7em-none-eabihf',
    installMethod: 'rustup',
    hal: 'stm32f4xx-hal',
    halVersion: '0.21.0',
    flashTool: 'probe-rs',
    description: 'ARM Cortex-M4 168MHz, FPU, 1MB Flash, 192KB SRAM.',
    infoUrl: 'https://www.st.com/en/microcontrollers-microprocessors/stm32f4-series.html',
    defaultCargoChip: 'stm32f407vg',
  },
];

export const ARCH_LABELS: Record<Arch, string> = {
  riscv: 'RISC-V',
  xtensa: 'Xtensa',
  arm: 'ARM',
};

export const ARCH_COLORS: Record<Arch, string> = {
  riscv: '#ba5b0ce3', // Orange-400
  xtensa: '#f59e0b', // Amber-500
  arm: '#ffffffef',    // Light Gray
};

export function getBoardsByVendor(): Record<string, BoardDefinition[]> {
  const grouped: Record<string, BoardDefinition[]> = {};
  for (const board of BOARDS) {
    if (!grouped[board.vendor]) grouped[board.vendor] = [];
    grouped[board.vendor].push(board);
  }
  return grouped;
}
