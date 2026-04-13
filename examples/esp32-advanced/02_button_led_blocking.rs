//! Button + LED (blocking, simple debounce).
//!
//! **esp-generate:** `--chip esp32 --headless -o esp-backtrace -o log` (no Embassy).
//!
//! **Wiring:** BOOT button is often **GPIO0** (pull-up); LED **GPIO2**. Change pins to match your board.

#![no_std]
#![no_main]

use esp_backtrace as _;
use esp_hal::{
    clock::CpuClock,
    gpio::{Input, InputConfig, Level, Output, OutputConfig, Pull},
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

    let button = Input::new(
        p.GPIO0,
        InputConfig::default().with_pull(Pull::Up),
    );
    let mut led = Output::new(p.GPIO2, Level::Low, OutputConfig::default());

    let mut stable_low_ms: u32 = 0;
    let mut led_on = false;

    loop {
        let pressed = button.is_low();

        if pressed {
            stable_low_ms = stable_low_ms.saturating_add(20);
        } else {
            stable_low_ms = 0;
        }

        // ~50 ms debounce
        if stable_low_ms >= 50 && !led_on {
            led_on = true;
            led.set_high();
            info!("button: pressed (debounced)");
        }

        if !pressed && led_on {
            led_on = false;
            led.set_low();
            info!("button: released");
        }

        busy_wait_ms(20);
    }
}

fn busy_wait_ms(ms: u32) {
    let start = Instant::now();
    while start.elapsed() < Duration::from_millis(ms as u64) {}
}
