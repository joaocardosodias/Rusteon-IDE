//! Advanced blocking example — replace `src/bin/main.rs` in an esp-generate project.
//!
//! **esp-generate (headless) e.g.:**
//! `esp-generate --chip esp32 --headless -o esp-backtrace -o log --name my_fw`
//! (Do not enable Embassy for this file.)
//!
//! **Hardware:** onboard LED is often GPIO2 on many ESP32 dev boards — adjust `LED_PIN` if needed.

#![no_std]
#![no_main]

use esp_backtrace as _;
use esp_hal::{
    clock::CpuClock,
    gpio::{Level, Output, OutputConfig},
    main,
    time::{Duration, Instant},
};
use log::info;

esp_bootloader_esp_idf::esp_app_desc!();

#[main]
fn main() -> ! {
    esp_println::logger::init_logger_from_env();

    let config = esp_hal::Config::default().with_cpu_clock(CpuClock::max());
    let p = esp_hal::init(config);

    // Onboard LED: GPIO2 on many ESP32 devkits — use GPIO4/GPIO5 etc. if your board differs.
    let mut led = Output::new(p.GPIO2, Level::Low, OutputConfig::default());

    let mut tick: u32 = 0;
    loop {
        tick = tick.wrapping_add(1);

        // Pattern: SOS-style timing (short / long) for visual “advanced” demo
        let (on_ms, off_ms) = match tick % 7 {
            0 | 2 | 4 => (120, 120), // three short
            6 => (400, 400),         // one long gap
            _ => (400, 200),
        };

        led.set_high();
        busy_wait_ms(on_ms);
        led.set_low();
        busy_wait_ms(off_ms);

        if tick % 20 == 0 {
            info!("ticks={}, LED pattern cycle", tick);
        }
    }
}

fn busy_wait_ms(ms: u32) {
    let start = Instant::now();
    while start.elapsed() < Duration::from_millis(ms as u64) {}
}
