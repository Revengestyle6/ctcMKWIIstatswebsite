"""Sort numbered division codes by their number, then by their full code."""

from sqlalchemy import BigInteger, cast, func


def division_order(column):
    number = cast(func.substring(column, r"^d([0-9]+)"), BigInteger)
    subnumber = cast(func.substring(column, r"^d[0-9]+_([0-9]+)"), BigInteger)
    return (number.asc().nulls_last(), subnumber.asc().nulls_first(), column.asc())
