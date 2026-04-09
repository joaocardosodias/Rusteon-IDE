#![no_std]
#![no_main]

use esp_backtrace as _;
use esp_println::println;
use esp_hal::{clock::ClockControl, peripherals::Peripherals, prelude::*, Delay};

#[entry]
fn main() -> ! {
    let peripherals = Peripherals::take();
    let system = peripherals.SYSTEM.split();
    let clocks = ClockControl::max(system.clock_control).freeze();
    let mut delay = Delay::new(&clocks);

    println!("Hello Rusteon from esp32s3!");

    loop {
        println!("Tick");
        delay.delay_ms(1000u32);
    }
}
