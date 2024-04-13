WOZ TEST IMAGES
Compiled by John K. Morris
jmorris@evolutioninteractive.com
v1.4 June 16, 2021

//\\//\\//\\//\\//\\//\\//\\//\\//\\//\\//\\//\\//\\//\\//\\//\\//\\//\\//\\//\\

This is a set of disk images intended to assist Apple ][ emulator developers in testing their implementations of floppy drives and drive controller cards.

The WOZ Disk Image Reference can be found at:
https://applesaucefdc.com/woz/reference2/

All of the images here have been tested in multiple emulators and are all verified as good images. You can trust them. If they don't work for some reason, then it is something about your implementation.

This archive contains WOZ 1.0, 2.0, and 2.1 images. The WOZ 2.x is the current specification, but I am also providing WOZ 1.0 to allow you to include backward compatibility. The files in the WOZ 2.1 folder are primarily for testing flux images.

//\\//\\//\\//\\//\\//\\//\\//\\//\\//\\//\\//\\//\\//\\//\\//\\//\\//\\//\\//\\

WHERE TO BEGIN
--------------

The "DOS 3.3 System Master" is a good place to start. Nicely organized nibbles and not doing any kind of gymnastics to the floppy soft switches. "The Apple at Play" is also a good choice for this. If you are supporting booting 13-sector disks, you can also give "DOS 3.2 System Master" a try.


NEXT CHOICES
------------

After you have System Master disks booting, you can move on to some slightly more complex disk images that are copy protected. These are all just basic tests, and not doing anything too crazy. "Bouncing Kamungas", "Commando", "Planetfall", "Rescue Raiders", "Sammy Lightfoot" and "Stargate"

These titles are your reward for getting this far in your woz implementation. Have some fun with them!


CROSS TRACK SYNC
----------------

The "Cross-Track Syncronization" of the woz reference covered this protection method and discussed the proper way to implement it. If you did this correctly, the disks "Blazing Paddles" and "Take 1" should be working properly. They both do a crazy cross track check when they boot up. If you get to the main menu of these, then consider yourself a winner.

More good tests for this is "Hard Hat Mack" and "Marble Madness". These have an extra-wide track on it that is actually 2 tracks wide. Being able to start playing a game means that you passed the checks.


HALF TRACKS
-----------

In order to test that you are address half tracks correctly, use "The Bilestoad". The first third of the disk is on full tracks and the rest on half tracks. If you can start a game, you have passed the check.


EVEN MORE BIT FIDDLING
----------------------

We are now getting to a few titles that do a fair amount of trickery with the soft switches, "Dino Eggs", "Crisis Mountain" and "Miner 2049er II". If you can start the games, then you have passed the checks.


WHEN BITS AREN'T REALLY BITS
----------------------------

For testing the MC3470 generation of fake bits, you can turn to "The Print Shop Companion". If you have control at the main menu, then you are passing this test.


WHAT IS THE LIFESPAN OF THE DATA LATCH?
---------------------------------------

When a program reads data from the data latch, the implementation should not be clearing the latch. "First math Adventures - Understanding Word Problems" is a good test of this. If you can get to the title screen, then you are good to go.


READING OFFSET DATA STREAMS
---------------------------

Some programs will reset the data latch mid way through a nibble (via LDA $C08D,x). This will cause the incoming data stream to read offset from the normal nibble starts. These streams will usually incorporate timing bits between nibbles that will not become data bits instead. Some good test candidates for this are "Wings of Fury" and "Stickybear Town Builder". If you can get to the title screens, then you have passed.


OPTIMAL BIT TIMING OF WOZ 2.0
-----------------------------

The official "rule" of Apple II floppy encoding is that the timing between bits is 4 microseconds. So, since there was a rule, people needed to break that rule. They would slow down or speed up the drives before writing them just to mess with bit copiers that would write data back out at 4. A good example of this is "Border Zone". The WOZ 2.0 file has an Optimal Bit Timing of 3.5 microseconds. It has a very timing dependent disk reader that will tend to lose sync with the disk if the bits are coming in at 4 microseconds, this causes some horrible delays when playing the game. A good test is to boot up the first disk, after loading for a while, it will ask for the next disk. Start a stopwatch when you insert the disk and press return. It will then take you to a menu where you can select which scenario you want to play from a list of 3. Press "1" to pick the first one "Train". Then it will scroll through a bunch of text that you need to keep hitting return when you see the "MORE" label. Finally you will be presented with the command prompt ">", this is when you check your stopwatch. Using a 4 microsecond bit timing, this little test can run almost a minute and a half. If you use the 3.5 microsecond timing as indicated in the WOZ file, then the test tends to take around 17 seconds.


FLUX TRACKS OF WOZ 2.1
----------------------

The WOZ 2.1 specification introduced the FLUX chunk with the ability to have an even lower level of accuracy than bits (at the expense of size). There is a ProDOS image in there that has every other track in flux format (0, 2, 4, 6, etc). If you can successfully boot this disk, then you know that you handling of flux-based tracks is working.

