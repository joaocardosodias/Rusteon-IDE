//! Two concurrent Embassy tasks (logging only — easy to extend with GPIO once you own pins in one task).
//!
//! **esp-generate e.g.:**
//! `esp-generate --chip esp32 --headless -o embassy -o unstable-hal -o esp-backtrace -o log --name my_async`
//!
//! Replace the generated `src/bin/main.rs` with this file (or merge the task + spawn parts).

#![no_std]
#![no_main]

use embassy_executor::{task, Spawner};
use embassy_time::{Duration, Timer};
use esp_backtrace as _;
use esp_hal::clock::CpuClock;
use esp_hal::timer::timg::TimerGroup;
use log::info;

esp_bootloader_esp_idf::esp_app_desc!();

#[task]
async fn slow_heartbeat() {
    let mut n: u32 = 0;
    loop {
        n = n.wrapping_add(1);
        info!("[slow] tick {}", n);
        Timer::after(Duration::from_secs(2)).await;
    }
}

#[task]
async fn fast_heartbeat() {
    let mut n: u32 = 0;
    loop {
        n = n.wrapping_add(1);
        info!("[fast] tick {}", n);
        Timer::after(Duration::from_millis(500)).await;
    }
}

#[esp_rtos::main]
async fn main(spawner: Spawner) -> ! {
    esp_println::logger::init_logger_from_env();

    let config = esp_hal::Config::default().with_cpu_clock(CpuClock::max());
    let peripherals = esp_hal::init(config);

    let timg0 = TimerGroup::new(peripherals.TIMG0);
    esp_rtos::start(timg0.timer0);

    info!("spawn: slow + fast tasks");

    match spawner.spawn(slow_heartbeat()) {
        Ok(()) => {}
        Err(_) => {
            info!("spawn slow_heartbeat failed");
        }
    }
    match spawner.spawn(fast_heartbeat()) {
        Ok(()) => {}
        Err(_) => {
            info!("spawn fast_heartbeat failed");
        }
    }

    // Idle: real work happens in tasks
    loop {
        Timer::after(Duration::from_secs(60)).await;
    }
}
