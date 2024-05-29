cmake_minimum_required(VERSION 3.12)

include($ENV{PICO_SDK_PATH}/pico_sdk_init.cmake)

project(picodrive)

pico_sdk_init()

add_subdirectory(./exe)

pico_enable_stdio_usb(picodrive 1)
pico_enable_stdio_uart(picodrive 0)



# Slow down flash during boot for heavy overclocking.
# pico_define_boot_stage2(slower_boot2 ${PICO_DEFAULT_BOOT_STAGE2_FILE})
# target_compile_definitions(slower_boot2 PRIVATE PICO_FLASH_SPI_CLKDIV=4)
# pico_set_boot_stage2(picodrive slower_boot2)
 