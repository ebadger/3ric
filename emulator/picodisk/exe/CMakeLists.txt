
project(picodrive)
add_executable(picodrive)

#pico_set_binary_type(picodrive no_flash)
pico_set_binary_type(picodrive copy_to_ram)

target_sources( picodrive PRIVATE
    picodisk.cpp
    driveemulator.cpp 
    wozdisk.cpp 
    wozfile.cpp 
    sdcard.cpp 
    hw_config.c 
    console.cpp )

pico_generate_pio_header(picodrive ${CMAKE_CURRENT_LIST_DIR}/ccsctrl.pio)
pico_generate_pio_header(picodrive ${CMAKE_CURRENT_LIST_DIR}/ccsdata.pio)
#pico_generate_pio_header(badger6502vm ${CMAKE_CURRENT_LIST_DIR}/vsync.pio)
#pico_generate_pio_header(badger6502vm ${CMAKE_CURRENT_LIST_DIR}/rgb_320.pio)
#pico_generate_pio_header(badger6502vm ${CMAKE_CURRENT_LIST_DIR}/rgb_640.pio)

add_subdirectory(../sdlib/FatFs_SPI build)

pico_add_extra_outputs(picodrive)

# use tinyusb implementation
# target_compile_definitions(badger6502vm PRIVATE PIO_USB_USE_TINYUSB)
# needed so tinyusb can find tusb_config.h

target_include_directories(picodrive PRIVATE ${CMAKE_CURRENT_LIST_DIR})
target_link_libraries(picodrive pico_stdlib pico_multicore pico_mem_ops FatFs_SPI hardware_pio)
