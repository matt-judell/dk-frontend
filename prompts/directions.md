# Denmark Frontend Project

There is a parquet file located at `/home/user/.bizval/dk/fundamental_data.pq`

It's contents look like this Polars schema:

```
Schema([('cvr', Int64),
        ('filing_date', Date),
        ('filing_url', String),
        ('filename', String),
        ('name', String),
        ('employees', Int64),
        ('house_number', Int64),
        ('street_name', String),
        ('city', String),
        ('postal_district', String),
        ('postal_code', Int64),
        ('addressId', String),
        ('net_income', Float64),
        ('assets', Float64),
        ('debt', Float64),
        ('cash', Float64),
        ('longitude', Float64),
        ('latitude', Float64),
        ('price', Float64),
        ('multiple', Int32)])
```

We want to use the contents to build a front-end to explore the data.

# Landing Page

Let's use deck.gl to show a map of all the entities. Each entity a cvr in the parquet file. Only create plots for the neweset (by filing_date) entry per cvr. Plot the location of the entity. Consider using the IconLayer.

# Detail Page

When you click on an entity you go to a detail page for the CVR.

It shows a table with
* filing_date
* assets
* debt
* cash
* price
* multiple

And a barchart of price over time

# Implementation Details

We want to ultimately deploy this as a Github page. Each visitor can load the whole parquet file, as it's only 11MB. Please develop a prototype that I can run locally. Please create instructions on how to test it locall.y
