NextEd is a web-based system for editing medical images (DICOM and Nifti are supported). You select a folder and it will find all the volumes in that folder system (a volume typically maps to a CT or MRI series). All volumes found will then be listed on the left panel. The user may open a volume and it will be displayed as a 4-view (Axial, Coronal, Sagittal, and Oblique). Just one fo these can be displayed by clicking the letter ('A', 'C', 'S') at the upper right corner of the image and in that view, clicking '4' will brin gyou back to the 4 view.
Scrolling the mouse wheel lets you select the slice and the cross-hairs are updated as you do that.
THe left panel shows a number of tools. At the upper right corner is  '?' which will display a help window explaining the tools and how to use them.
Clicking 'Back to Volumes' will bring you back to the list of volumes in the selected folder. 
You can change the selected folder from the Volumes list view by clicking 'Open Folder'



-----  INSTALLATION  -----
To use this, clone the repo. 
You will need to get the uv environment running:
   In the main folder, run: uv venv
   Then 'cd server'
       'uv sync'
then 'cd ..' to get back into the main folder and './start.sh' to start the system
