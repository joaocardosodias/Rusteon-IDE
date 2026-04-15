//! Demo: upload-friendly ESP32 example that also showcases Diagnostics fixes.
//!
//! This file is meant for recording videos in Rusteon IDE:
//! 1) Replace your `src/bin/main.rs` with this file.
//! 2) Build once to trigger missing-crate diagnostics (on fresh projects).
//! 3) Use Library Manager -> Diagnostics -> FIX.
//! 4) Build again and Upload.
//!
//! Suggested project generation:
//! `esp-generate --chip esp32 --headless -o esp-backtrace -o log --name rusteon_demo`

#![no_std]
#![no_main]

use esp_backtrace as _;
use esp_hal::{
    clock::CpuClock,
    delay::Delay,
    gpio::{Level, Output, OutputConfig},
    main,
};
use esp_println::{print, println};

// External crates intentionally used to demonstrate Diagnostics auto-fix on fresh templates.
use heapless::Vec;
use micromath::F32Ext;

esp_bootloader_esp_idf::esp_app_desc!();

#[main]
fn main() -> ! {
    let cfg = esp_hal::Config::default().with_cpu_clock(CpuClock::max());
    let p = esp_hal::init(cfg);
    let mut delay = Delay::new();

    println!("Rusteon demo booting...");
    println!("Serial baud: 115200");

    // Typical onboard LED on many ESP32 devkits.
    let mut led = Output::new(p.GPIO2, Level::Low, OutputConfig::default());

    let mut tick: u32 = 0;
    loop {
        tick = tick.wrapping_add(1);

        // Use micromath just to prove external crate integration in no_std firmware.
        let wave = ((tick as f32) * 0.18).sin();
        let sign = if wave >= 0.0 { '+' } else { '-' };

        // Use heapless too, but keep the output simple and very visible in Serial Monitor.
        let mut marks: Vec<u8, 4> = Vec::new();
        let _ = marks.push(b'#');
        let _ = marks.push(sign as u8);
        println!(
            "[tick] {} [{}]",
            tick,
            core::str::from_utf8(&marks).unwrap_or("#?")
        );
        print!("");

        led.set_high();
        delay.delay_millis(100);
        led.set_low();
        delay.delay_millis(900);
    }
}
