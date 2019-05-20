
# Wix Page Clustering
## Converting site data into spreadsheets


#### To Activate
git clone git@github.com:wix-a/page-cluster.git

cd page-cluster

yarn

  
#### Usage

yarn cluster -site:SITE_NAME -result:RESULT_DIR

#### Example

yarn cluster -site:shaiby4.wixsite.com/samples -result:/Users/shaiby/tmp/s1

  ## Result

In the result directory you will find the following files:

    -rw-r--r--  1 shaiby  WIXPRESS\Domain Users  183 May 20 12:26 Txt-def.json
    -rw-r--r--  1 shaiby  WIXPRESS\Domain Users  234 May 20 12:26 Txt.csv
    -rw-r--r--  1 shaiby  WIXPRESS\Domain Users   23 May 20 12:26 statistics.txt

#### csv file for each cluster - spreadsheet content
For example:

    "title","StyledText","StyledText_html"
    "HOME","p1","<h1 class=""font_0"">p1</h1>"
    "Page2","p4","<h1 class=""font_0"">p4</h1>"
    "Page3","p3","<h1 class=""font_0"">p3</h1>"
    "Page4","p2","<h1 class=""font_0"">p2</h1>"

As you can see, the algorithm can not figure out the field names, so you need to rename it and unify sheets if needed.

#### statistics.txt
For example:

    4: 1-1
    Coverage: 4 of 4



  
