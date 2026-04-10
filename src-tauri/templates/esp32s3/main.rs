#![no_std]
#![no_main]

use esp_backtrace as _;
use esp_hal::{
    main,
    time::{Duration, Instant},
};
use esp_println::println;

// App Descriptor exigido pelo espflash 3.x
esp_bootloader_esp_idf::esp_app_desc!();

#[main]
fn main() -> ! {
    let _peripherals = esp_hal::init(esp_hal::Config::default());

    println!("Hello from Rusteon IDE!");

    let mut contador: u32 = 0;

    loop {
        println!("Tick {}", contador);
        contador = contador.wrapping_add(1);

        let start = Instant::now();
        while start.elapsed() < Duration::from_millis(1000) {}
    }
}
